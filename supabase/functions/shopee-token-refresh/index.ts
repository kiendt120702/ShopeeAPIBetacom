/**
 * Supabase Edge Function: Shopee Token Refresh
 * Tự động refresh token cho các shop sắp hết hạn
 * Chạy mỗi phút qua pg_cron
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac } from 'https://deno.land/std@0.168.0/node/crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SHOPEE_BASE_URL = Deno.env.get('SHOPEE_BASE_URL') || 'https://partner.shopeemobile.com';
const PROXY_URL = Deno.env.get('SHOPEE_PROXY_URL') || '';

/**
 * Helper function để gọi API qua proxy hoặc trực tiếp
 */
async function fetchWithProxy(targetUrl: string, options: RequestInit): Promise<Response> {
  if (PROXY_URL) {
    const proxyUrl = `${PROXY_URL}?url=${encodeURIComponent(targetUrl)}`;
    return await fetch(proxyUrl, options);
  }
  return await fetch(targetUrl, options);
}

/**
 * Tạo signature cho Shopee API
 */
function createSignature(
  partnerId: number,
  partnerKey: string,
  path: string,
  timestamp: number
): string {
  const baseString = `${partnerId}${path}${timestamp}`;
  const hmac = createHmac('sha256', partnerKey);
  hmac.update(baseString);
  return hmac.digest('hex');
}

/**
 * Refresh access token từ Shopee API
 */
async function refreshAccessToken(
  partnerId: number,
  partnerKey: string,
  refreshToken: string,
  shopId: number
) {
  const timestamp = Math.floor(Date.now() / 1000);
  const path = '/api/v2/auth/access_token/get';
  const sign = createSignature(partnerId, partnerKey, path, timestamp);

  const body = {
    refresh_token: refreshToken,
    partner_id: partnerId,
    shop_id: shopId,
  };

  const url = `${SHOPEE_BASE_URL}${path}?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign}`;

  const response = await fetchWithProxy(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return await response.json();
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log('[TOKEN-REFRESH] Starting auto-refresh job...');

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    
    const now = Date.now();
    const bufferMs = 30 * 60 * 1000; // Refresh 30 phút trước khi hết hạn
    const thresholdTime = now + bufferMs;
    const expiredThreshold = now - 24 * 60 * 60 * 1000; // Không refresh token hết hạn quá 24h

    // Lấy các shop có token sắp hết hạn
    const { data: shopsToRefresh, error: fetchError } = await supabase
      .from('apishopee_shops')
      .select('shop_id, shop_name, refresh_token, expired_at, partner_id, partner_key')
      .not('refresh_token', 'is', null)
      .not('partner_key', 'is', null)
      .lt('expired_at', thresholdTime)
      .gt('expired_at', expiredThreshold)
      .limit(10); // Giới hạn 10 shop mỗi lần để tránh timeout

    if (fetchError) {
      console.error('[TOKEN-REFRESH] Error fetching shops:', fetchError);
      return new Response(JSON.stringify({ 
        success: false, 
        error: fetchError.message 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[TOKEN-REFRESH] Found ${shopsToRefresh?.length || 0} shops need refresh`);

    if (!shopsToRefresh || shopsToRefresh.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No tokens need refresh',
        processed: 0,
        duration_ms: Date.now() - startTime,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results = [];

    for (const shop of shopsToRefresh) {
      try {
        console.log(`[TOKEN-REFRESH] Refreshing shop ${shop.shop_id} (${shop.shop_name || 'unnamed'})...`);
        
        // Gọi Shopee API trực tiếp
        const tokenData = await refreshAccessToken(
          shop.partner_id,
          shop.partner_key,
          shop.refresh_token,
          shop.shop_id
        );

        if (tokenData.error) {
          console.error(`[TOKEN-REFRESH] Shopee API error for shop ${shop.shop_id}:`, tokenData);
          results.push({ 
            shop_id: shop.shop_id, 
            shop_name: shop.shop_name,
            status: 'failed', 
            error: tokenData.message || tokenData.error 
          });
          continue;
        }

        // Cập nhật token mới vào database
        const newExpiredAt = Date.now() + (tokenData.expire_in || 14400) * 1000;
        
        const { error: updateError } = await supabase
          .from('apishopee_shops')
          .update({
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expire_in: tokenData.expire_in,
            expired_at: newExpiredAt,
            token_updated_at: new Date().toISOString(),
          })
          .eq('shop_id', shop.shop_id);

        if (updateError) {
          console.error(`[TOKEN-REFRESH] DB update error for shop ${shop.shop_id}:`, updateError);
          results.push({ 
            shop_id: shop.shop_id, 
            shop_name: shop.shop_name,
            status: 'db_error', 
            error: updateError.message 
          });
        } else {
          console.log(`[TOKEN-REFRESH] ✓ Shop ${shop.shop_id} refreshed, expires at ${new Date(newExpiredAt).toISOString()}`);
          results.push({ 
            shop_id: shop.shop_id, 
            shop_name: shop.shop_name,
            status: 'refreshed',
            new_expired_at: newExpiredAt,
          });
        }

        // Delay 500ms giữa các request để tránh rate limit
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (shopErr) {
        console.error(`[TOKEN-REFRESH] Exception for shop ${shop.shop_id}:`, shopErr);
        results.push({ 
          shop_id: shop.shop_id, 
          shop_name: shop.shop_name,
          status: 'exception', 
          error: (shopErr as Error).message 
        });
      }
    }

    const successCount = results.filter(r => r.status === 'refreshed').length;
    const failedCount = results.filter(r => r.status !== 'refreshed').length;

    console.log(`[TOKEN-REFRESH] Completed: ${successCount} success, ${failedCount} failed`);

    return new Response(JSON.stringify({
      success: true,
      processed: results.length,
      refreshed: successCount,
      failed: failedCount,
      duration_ms: Date.now() - startTime,
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[TOKEN-REFRESH] Fatal error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: (error as Error).message,
      duration_ms: Date.now() - startTime,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
