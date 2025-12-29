/**
 * Supabase Edge Function: Shopee Cron
 * Scheduled job để tự động:
 * 1. Refresh token cho các shop sắp hết hạn
 * 2. Đồng bộ dữ liệu định kỳ
 * 3. Xử lý lịch hẹn Flash Sale
 * 4. Điều chỉnh ngân sách Ads theo lịch
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

serve(async (req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const allResults: Record<string, unknown> = {};

    // ========== 0. AUTO-REFRESH TOKEN CHO CÁC SHOP SẮP HẾT HẠN ==========
    console.log('[CRON] Checking tokens to refresh...');
    try {
      const now = Date.now();
      const bufferMs = 30 * 60 * 1000; // Refresh 30 phút trước khi hết hạn
      const thresholdTime = now + bufferMs;

      // Lấy các shop có token sắp hết hạn hoặc đã hết hạn (trong vòng 24h qua)
      const expiredThreshold = now - 24 * 60 * 60 * 1000; // Không refresh token hết hạn quá 24h
      
      const { data: shopsToRefresh, error: fetchError } = await supabase
        .from('apishopee_shops')
        .select('shop_id, refresh_token, expired_at, partner_id, partner_key')
        .not('refresh_token', 'is', null)
        .not('partner_key', 'is', null)
        .lt('expired_at', thresholdTime)
        .gt('expired_at', expiredThreshold);

      if (fetchError) {
        console.error('[CRON] Error fetching shops to refresh:', fetchError);
        allResults.token_refresh = { status: 'error', error: fetchError.message };
      } else {
        console.log(`[CRON] Found ${shopsToRefresh?.length || 0} shops need token refresh`);
        
        const refreshResults = [];
        for (const shop of shopsToRefresh || []) {
          try {
            console.log(`[CRON] Refreshing token for shop ${shop.shop_id}...`);
            
            const { data: refreshData, error: refreshError } = await supabase.functions.invoke('shopee-auth', {
              body: {
                action: 'refresh-token',
                refresh_token: shop.refresh_token,
                shop_id: shop.shop_id,
                partner_info: {
                  partner_id: shop.partner_id,
                  partner_key: shop.partner_key,
                },
              },
            });

            if (refreshError || refreshData?.error) {
              const errMsg = refreshError?.message || refreshData?.message || refreshData?.error;
              console.error(`[CRON] Failed to refresh token for shop ${shop.shop_id}:`, errMsg);
              refreshResults.push({ shop_id: shop.shop_id, status: 'failed', error: errMsg });
            } else {
              console.log(`[CRON] Token refreshed for shop ${shop.shop_id}`);
              refreshResults.push({ shop_id: shop.shop_id, status: 'refreshed' });
            }

            // Delay giữa các request để tránh rate limit
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (shopErr) {
            console.error(`[CRON] Exception refreshing shop ${shop.shop_id}:`, shopErr);
            refreshResults.push({ shop_id: shop.shop_id, status: 'exception', error: (shopErr as Error).message });
          }
        }

        allResults.token_refresh = { 
          status: 'completed', 
          total: shopsToRefresh?.length || 0,
          results: refreshResults 
        };
      }
    } catch (tokenErr) {
      console.error('[CRON] Token refresh exception:', tokenErr);
      allResults.token_refresh = { status: 'exception', error: (tokenErr as Error).message };
    }

    // ========== 1. XỬ LÝ LỊCH HẸN FLASH SALE ==========
    console.log('[CRON] Processing Flash Sale schedules...');
    try {
      const { data: fsResult, error: fsError } = await supabase.functions.invoke('shopee-scheduler', {
        body: { action: 'process' }
      });
      
      if (fsError) {
        console.error('[CRON] Flash Sale scheduler error:', fsError);
        allResults.flash_sale_scheduler = { status: 'error', error: fsError.message };
      } else {
        console.log('[CRON] Flash Sale scheduler result:', fsResult);
        allResults.flash_sale_scheduler = { status: 'completed', ...fsResult };
      }
    } catch (fsErr) {
      console.error('[CRON] Flash Sale scheduler exception:', fsErr);
      allResults.flash_sale_scheduler = { status: 'exception', error: (fsErr as Error).message };
    }

    // ========== 2. XỬ LÝ LỊCH NGÂN SÁCH ADS ==========
    console.log('[CRON] Processing Ads Budget schedules...');
    try {
      const { data: adsResult, error: adsError } = await supabase.functions.invoke('shopee-ads-scheduler', {
        body: { action: 'process' }
      });
      
      if (adsError) {
        console.error('[CRON] Ads Budget scheduler error:', adsError);
        allResults.ads_budget_scheduler = { status: 'error', error: adsError.message };
      } else {
        console.log('[CRON] Ads Budget scheduler result:', adsResult);
        allResults.ads_budget_scheduler = { status: 'completed', ...adsResult };
      }
    } catch (adsErr) {
      console.error('[CRON] Ads Budget scheduler exception:', adsErr);
      allResults.ads_budget_scheduler = { status: 'exception', error: (adsErr as Error).message };
    }

    // ========== 3. ĐỒNG BỘ DỮ LIỆU SHOPS ==========
    console.log('[CRON] Syncing shop data...');
    const { data: shopsToSync, error } = await supabase
      .from('apishopee_sync_status')
      .select('shop_id, user_id')
      .eq('auto_sync_enabled', true)
      .limit(10);

    if (error) {
      throw error;
    }

    console.log(`[CRON] Found ${shopsToSync?.length || 0} shops to sync`);

    const syncResults = [];
    
    for (const shop of shopsToSync || []) {
      try {
        const { data: syncResult, error: syncError } = await supabase.functions.invoke('shopee-sync-worker', {
          body: {
            action: 'sync-flash-sale-data',
            shop_id: shop.shop_id,
            user_id: shop.user_id,
          }
        });

        if (syncError) {
          console.error(`Sync failed for shop ${shop.shop_id}:`, syncError);
          syncResults.push({ shop_id: shop.shop_id, status: 'failed', error: syncError.message });
        } else {
          console.log(`Sync completed for shop ${shop.shop_id}`);
          syncResults.push({ shop_id: shop.shop_id, status: 'completed' });
        }

        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (shopError) {
        console.error(`Error processing shop ${shop.shop_id}:`, shopError);
        syncResults.push({ shop_id: shop.shop_id, status: 'error', error: (shopError as Error).message });
      }
    }

    allResults.data_sync = { processed: syncResults.length, results: syncResults };

    return new Response(JSON.stringify({
      success: true,
      timestamp: new Date().toISOString(),
      ...allResults
    }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Cron job error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: (error as Error).message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});