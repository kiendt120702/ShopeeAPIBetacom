import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { getCampaignIdList, getCampaignSettingInfo, type CampaignIdItem, type AdType, type CommonInfo } from '@/lib/shopee';
import { cn } from '@/lib/utils';

interface CampaignData extends CampaignIdItem { name?: string; status?: string; common_info?: CommonInfo; }

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  ongoing: { label: 'Đang chạy', color: 'bg-green-100 text-green-700' },
  paused: { label: 'Tạm dừng', color: 'bg-yellow-100 text-yellow-700' },
  scheduled: { label: 'Đã lên lịch', color: 'bg-blue-100 text-blue-700' },
  ended: { label: 'Đã kết thúc', color: 'bg-gray-100 text-gray-700' },
  deleted: { label: 'Đã xóa', color: 'bg-red-100 text-red-700' },
  closed: { label: 'Đã đóng', color: 'bg-gray-100 text-gray-600' },
};
const AD_TYPE_MAP: Record<string, { label: string; color: string }> = { auto: { label: 'Tự động', color: 'bg-purple-100 text-purple-700' }, manual: { label: 'Thủ công', color: 'bg-indigo-100 text-indigo-700' } };

export default function AdsPanel() {
  const { toast } = useToast();
  const { token, isAuthenticated } = useShopeeAuth();
  const [loading, setLoading] = useState(false);
  const [campaigns, setCampaigns] = useState<CampaignData[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('ongoing');
  const formatPrice = (p: number) => new Intl.NumberFormat('vi-VN').format(p) + 'đ';
  const filteredCampaigns = statusFilter === 'all' ? campaigns : campaigns.filter(c => c.status === statusFilter);

  useEffect(() => { if (isAuthenticated && token?.shop_id) { loadCampaigns(); } }, [isAuthenticated, token?.shop_id]);

  const loadCampaigns = async () => {
    if (!token?.shop_id) return;
    setLoading(true);
    try {
      // Load trực tiếp từ database
      const { data: cached } = await supabase
        .from('apishopee_ads_campaign_data')
        .select('*')
        .eq('shop_id', token.shop_id)
        .order('status', { ascending: true });
      
      if (cached && cached.length > 0) {
        setCampaigns(cached.map(c => ({ 
          campaign_id: c.campaign_id, 
          ad_type: c.ad_type as 'auto' | 'manual', 
          name: c.name, 
          status: c.status, 
          common_info: { 
            ad_type: c.ad_type as 'auto' | 'manual', 
            ad_name: c.name || '', 
            campaign_status: c.status as any, 
            campaign_placement: c.campaign_placement as any, 
            bidding_method: c.bidding_method as any, 
            campaign_budget: c.campaign_budget, 
            campaign_duration: { start_time: c.start_time || 0, end_time: c.end_time || 0 }, 
            item_id_list: [] 
          } 
        })));
      }
    } catch (e) {
      console.error('Load campaigns error:', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchFromAPI = async () => {
    if (!token?.shop_id) return;
    setLoading(true);
    try {
      const res = await getCampaignIdList({ shop_id: token.shop_id, ad_type: 'all' as AdType });
      if (res.error && res.error !== '-') { 
        toast({ title: 'Lỗi', description: res.message, variant: 'destructive' }); 
        setLoading(false); 
        return; 
      }
      const list = res.response?.campaign_list || [];
      if (!list.length) { setCampaigns([]); setLoading(false); return; }
      
      const withInfo: CampaignData[] = [...list];
      for (let i = 0; i < list.length; i += 100) {
        const batch = list.slice(i, i + 100);
        try {
          const detail = await getCampaignSettingInfo({ shop_id: token.shop_id, campaign_id_list: batch.map(c => c.campaign_id), info_type_list: '1,3' });
          detail.response?.campaign_list?.forEach(d => { 
            const idx = withInfo.findIndex(c => c.campaign_id === d.campaign_id); 
            if (idx !== -1) withInfo[idx] = { ...withInfo[idx], name: d.common_info?.ad_name, status: d.common_info?.campaign_status, common_info: d.common_info }; 
          });
        } catch {}
      }
      setCampaigns(withInfo);
      
      // Lưu vào database
      const cacheData = withInfo.map(c => ({
        shop_id: token.shop_id,
        campaign_id: c.campaign_id,
        ad_type: c.ad_type,
        name: c.name || null,
        status: c.status || null,
        campaign_placement: c.common_info?.campaign_placement || null,
        bidding_method: c.common_info?.bidding_method || null,
        campaign_budget: c.common_info?.campaign_budget || 0,
        start_time: c.common_info?.campaign_duration?.start_time || null,
        end_time: c.common_info?.campaign_duration?.end_time || null,
        item_count: c.common_info?.item_id_list?.length || 0,
        synced_at: new Date().toISOString(),
      }));
      await supabase.from('apishopee_ads_campaign_data').upsert(cacheData, { onConflict: 'shop_id,campaign_id' });
      
      toast({ title: 'Thành công', description: 'Đã tải ' + list.length + ' chiến dịch' });
    } catch (e) { 
      toast({ title: 'Lỗi', description: (e as Error).message, variant: 'destructive' }); 
    } finally { 
      setLoading(false); 
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-50 overflow-hidden">
      <div className="bg-white border-b flex-shrink-0">
        <div className="px-4 py-2 border-b flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500">Trạng thái:</span>
          <button onClick={() => setStatusFilter('all')} className={cn("px-2.5 py-1 rounded-full text-xs font-medium transition-colors", statusFilter === 'all' ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>Tất cả ({campaigns.length})</button>
          {Object.entries(STATUS_MAP).map(([key, { label }]) => {
            const count = campaigns.filter(c => c.status === key).length;
            if (count === 0) return null;
            const isActive = statusFilter === key;
            const colors: Record<string, { active: string; inactive: string }> = {
              ongoing: { active: 'bg-green-500 text-white', inactive: 'bg-green-100 text-green-700 hover:bg-green-200' },
              paused: { active: 'bg-yellow-500 text-white', inactive: 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' },
              scheduled: { active: 'bg-blue-500 text-white', inactive: 'bg-blue-100 text-blue-700 hover:bg-blue-200' },
              ended: { active: 'bg-gray-500 text-white', inactive: 'bg-gray-100 text-gray-700 hover:bg-gray-200' },
              deleted: { active: 'bg-red-500 text-white', inactive: 'bg-red-100 text-red-700 hover:bg-red-200' },
              closed: { active: 'bg-gray-600 text-white', inactive: 'bg-gray-100 text-gray-600 hover:bg-gray-200' },
            };
            return <button key={key} onClick={() => setStatusFilter(key)} className={cn("px-2.5 py-1 rounded-full text-xs font-medium transition-colors", isActive ? colors[key]?.active : colors[key]?.inactive)}>{label} ({count})</button>;
          })}
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={fetchFromAPI} disabled={loading}>{loading ? 'Đang tải...' : 'Đồng bộ'}</Button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <div className="p-4">
            {loading ? <div className="text-center py-12"><div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" /><p className="text-gray-500">Đang tải...</p></div>
            : campaigns.length === 0 ? <div className="text-center py-12 text-gray-400"><p className="font-medium">Chưa có chiến dịch</p><p className="text-sm mt-1">Nhấn Đồng bộ để tải</p></div>
            : filteredCampaigns.length === 0 ? <div className="text-center py-12 text-gray-400"><p className="font-medium">Không có chiến dịch nào</p><p className="text-sm mt-1">Thử chọn trạng thái khác</p></div>
            : <div className="bg-white rounded-lg border overflow-hidden">
                <div className="grid grid-cols-[minmax(0,1fr)_90px_100px] gap-2 px-4 py-3 bg-gray-50 border-b text-xs font-medium text-gray-500"><div>Tên</div><div>Trạng thái</div><div className="text-right">Ngân sách</div></div>
                <div className="divide-y">
                  {filteredCampaigns.map(c => <div key={c.campaign_id} className="grid grid-cols-[minmax(0,1fr)_90px_100px] gap-2 px-4 py-3 items-center hover:bg-gray-50">
                    <div className="min-w-0"><p className="font-medium text-sm line-clamp-2">{c.name || 'Campaign ' + c.campaign_id}</p><p className="text-xs text-gray-400">ID: {c.campaign_id}</p></div>
                    <div><span className={cn("text-xs px-2 py-0.5 rounded", STATUS_MAP[c.status || '']?.color)}>{STATUS_MAP[c.status || '']?.label || '-'}</span></div>
                    <div className="text-sm text-right font-medium text-orange-600">{c.common_info?.campaign_budget ? formatPrice(c.common_info.campaign_budget) : '-'}</div>
                  </div>)}
                </div>
              </div>}
          </div>
      </div>
    </div>
  );
}
