/**
 * Supabase Edge Function: Shopee Token Auto-Refresh
 * Tự động refresh token cho các shop sắp hết hạn
 * Chạy định kỳ qua pg_cron hoặc external cron
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const DEFAULT_PARTNER_ID = Number(Deno.env.get('SHOPEE_PARTNER_ID'));
const DEFAULT_PARTNER_KEY = Deno.env.get('SHOPEE_PARTNER_KEY') || '';
const SHOPEE_BASE_URL = Deno.env.get('SHOPEE_BASE_URL') || 'https://partner.shopeemobile.com';
const PROXY_URL = Deno.env.get('SHOPEE_PROXY_URL') || '';

// Refresh token nếu còn dưới 5 phút
const TOKEN_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

interface ShopToken {
  shop_id: number;
  shop_name: string | null;
  access_token: string;
  refresh_token: string;
  expired_at: number;
  partner_id: number | null;
  partner_key: string | null;
}

/**
 * Tạo signature cho Shopee API
 */
async function createSignature(
  partnerKey: string,
  partnerId: number,
  path: string,
  timestamp: number
): Promise<string> {
  const baseString = `${partnerId}${path}${timestamp}`;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(partnerKey);
  const messageData = encoder.encode(baseString);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Gọi API qua proxy hoặc trực tiếp
 */
async function fetchWithProxy(url: string, options: RequestInit): Promise<Response> {
  if (PROXY_URL) {
    const proxyUrl = `${PROXY_URL}?url=${encodeURIComponent(url)}`;
    return await fetch(proxyUrl, options);
  }
  return await fetch(url, options);
}

/**
 * Refresh access token từ Shopee
 */
async function refreshAccessToken(
  partnerId: number,
  partnerKey: string,
  refreshToken: string,
  shopId: number
): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const path = '/api/v2/auth/access_token/get';
    const sign = await createSignature(partnerKey, partnerId, path, timestamp);

    const url = `${SHOPEE_BASE_URL}${path}?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign}`;

    const response = await fetchWithProxy(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refresh_token: refreshToken,
        partner_id: partnerId,
        shop_id: shopId,
      }),
    });

    const data = await response.json();

    if (data.error && data.error !== '' && data.error !== '-') {
      return { success: false, error: data.message || data.error };
    }

    return { success: true, data };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const now = Date.now();
    const thresholdTime = now + TOKEN_REFRESH_THRESHOLD_MS;

    // Lấy các shop có token sắp hết hạn (trong 1 giờ tới) hoặc đã hết hạn
    const { data: shopsToRefresh, error: queryError } = await supabase
      .from('shops')
      .select('shop_id, shop_name, access_token, refresh_token, expired_at, partner_id, partner_key')
      .not('refresh_token', 'is', null)
      .not('access_token', 'is', null)
      .lt('expired_at', thresholdTime)
      .order('expired_at', { ascending: true })
      .limit(20); // Giới hạn 20 shops mỗi lần

    if (queryError) {
      throw queryError;
    }

    console.log(`[TOKEN-REFRESH] Found ${shopsToRefresh?.length || 0} shops need token refresh`);

    if (!shopsToRefresh || shopsToRefresh.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No shops need token refresh',
        refreshed: 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results: Array<{
      shop_id: number;
      shop_name: string | null;
      status: 'success' | 'failed';
      message: string;
      old_expired_at?: string;
      new_expired_at?: string;
    }> = [];

    for (const shop of shopsToRefresh as ShopToken[]) {
      const partnerId = shop.partner_id || DEFAULT_PARTNER_ID;
      const partnerKey = shop.partner_key || DEFAULT_PARTNER_KEY;

      if (!partnerId || !partnerKey) {
        results.push({
          shop_id: shop.shop_id,
          shop_name: shop.shop_name,
          status: 'failed',
          message: 'Missing partner credentials',
        });
        continue;
      }

      console.log(`[TOKEN-REFRESH] Refreshing token for shop ${shop.shop_id} (${shop.shop_name})`);

      const refreshResult = await refreshAccessToken(
        partnerId,
        partnerKey,
        shop.refresh_token,
        shop.shop_id
      );

      if (refreshResult.success && refreshResult.data) {
        const newExpiredAt = now + (refreshResult.data.expire_in as number) * 1000;

        // Cập nhật token mới vào database
        const { error: updateError } = await supabase
          .from('shops')
          .update({
            access_token: refreshResult.data.access_token,
            refresh_token: refreshResult.data.refresh_token,
            expire_in: refreshResult.data.expire_in,
            expired_at: newExpiredAt,
            token_updated_at: new Date().toISOString(),
          })
          .eq('shop_id', shop.shop_id);

        if (updateError) {
          results.push({
            shop_id: shop.shop_id,
            shop_name: shop.shop_name,
            status: 'failed',
            message: `DB update failed: ${updateError.message}`,
          });
        } else {
          results.push({
            shop_id: shop.shop_id,
            shop_name: shop.shop_name,
            status: 'success',
            message: 'Token refreshed successfully',
            old_expired_at: new Date(shop.expired_at).toISOString(),
            new_expired_at: new Date(newExpiredAt).toISOString(),
          });
          console.log(`[TOKEN-REFRESH] ✅ Shop ${shop.shop_id} token refreshed, new expiry: ${new Date(newExpiredAt).toISOString()}`);
        }
      } else {
        results.push({
          shop_id: shop.shop_id,
          shop_name: shop.shop_name,
          status: 'failed',
          message: refreshResult.error || 'Unknown error',
        });
        console.error(`[TOKEN-REFRESH] ❌ Shop ${shop.shop_id} refresh failed: ${refreshResult.error}`);
      }

      // Delay 1s giữa các requests để tránh rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const successCount = results.filter(r => r.status === 'success').length;
    const failedCount = results.filter(r => r.status === 'failed').length;

    console.log(`[TOKEN-REFRESH] Completed: ${successCount} success, ${failedCount} failed`);

    return new Response(JSON.stringify({
      success: true,
      refreshed: successCount,
      failed: failedCount,
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[TOKEN-REFRESH] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: (error as Error).message,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
