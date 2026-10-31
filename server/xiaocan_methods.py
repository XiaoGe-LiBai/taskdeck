"""小蚕网关方法表：函数名 → (微服务, 方法名)。

由开源版 client.py 的调用点整理而来（接口事实），本文件只是映射，不含对方代码。
`call()` 负责统一注入 silk_id / app_id 与签名调用，业务层按 key 取用。
"""
from __future__ import annotations

from typing import Any

import xiaocan_bridge as xc

# 活动类接口统一用 app_id=10（与登录的 25 不同）
ACTIVITY_APP_ID = 10

METHODS: dict[str, tuple[str, str]] = {
    "add_lottery_times": ("SilkwormLottery", "SilkwormLotteryMobile.AddLotteryTimes"),
    "appoint_store": ("Promotion", "PromotionService.AppointOrder"),
    "cancel_promotion_quota": ("Silkworm", "SilkwormService.CancelPromotionQuota"),
    "check_activity_eligibility": ("SilkwormShareSupport", "SilkwormShareSupportService.CheckActivityEligibility"),
    "claim_ad_lottery_chance": ("SilkwormLottery", "SilkwormLotteryMobile.OnAdViewed"),
    "client_withdraw": ("Silkworm", "SilkwormService.ClientWithdraw"),
    "collect_points": ("ActivityTask", "ActivityTaskMobileService.CollectPoints"),
    "complete_activity_task": ("ActivityTask", "ActivityTaskMobileService.CompleteTask"),
    "complete_task_event": ("SilkwormMarketing", "SilkwormMobileMarketingService.CompleteTaskEvent"),
    "do_lottery_spin": ("SilkwormLottery", "SilkwormLotteryMobile.Lottery"),
    "do_user_sign": ("ActivityTask", "ActivityTaskMobileService.SignIn"),
    "draw_page_gift": ("SilkwormMarketing", "SilkwormMobileMarketingService.DrawPageGift"),
    "exchange_goods": ("SilkwormCommunity", "SilkwormMobileCommunityService.ExchangeGoods"),
    "get_app_redpack_list": ("RedPackService", "RedPackService.GetAppRedPackList"),
    "get_brand_card_info": ("SilkwormVip", "VipRightsService.BrandCardInfo"),
    "get_client_withdraw_list": ("Silkworm", "SilkwormService.GetClientWithdrawList"),
    "get_daily_tasks": ("ActivityTask", "ActivityTaskMobileService.GetDailyTask"),
    "get_explore_store_list": ("SilkwormExplore", "ExploreMobile.ListGroupPromotion"),
    "get_extra_brand_card_pool": ("SilkwormVip", "VipRightsService.ExtraBrandCardPool"),
    "get_lottery_info": ("SilkwormLottery", "SilkwormLotteryMobile.LotteryInfo"),
    "get_lottery_progress": ("SilkwormLottery", "SilkwormLotteryMobile.GetLotteryProgress"),
    "get_message_channels": ("SilkwormMessageCenter", "MessageCenterService.ListChannelsSimple"),
    "get_messages": ("SilkwormMessageCenter", "MessageCenterService.ListMessages"),
    "get_order_list": ("Silkworm", "SilkwormService.GetPromotionOrderList"),
    "get_plus_vip_rebate_card_infos": ("SilkwormVip", "VipRightsService.PlusVipRebateCardInfos"),
    "get_redpack_rain_event": ("SilkwormLottery", "SilkwormLotteryMobile.GetRedPackRainEvent"),
    "get_sign_in_history": ("ActivityTask", "ActivityTaskMobileService.SignInHistory"),
    "get_sign_in_node": ("SilkwormVip", "VipRightsService.SignInNode"),
    "get_store_list": ("SilkwormFusion", "FusionService.GetFeedPromotions"),
    "get_store_promotion_detail": ("SilkwormFusion", "FusionService.GetFusionPromotionDetail"),
    "get_unreceived_point_records": ("ActivityTask", "ActivityTaskMobileService.GetUnReceivedPointRecords"),
    "get_user_card_list": ("SilkwormCard", "SilkwormCardService.GetUserCardList"),
    "get_user_card_number": ("SilkwormCard", "SilkwormCardService.GetUserCardNumber"),
    "get_user_free_order_info": ("SilkwormVip", "VipRightsService.UserFreeOrderInfo"),
    "get_user_info": ("Silkworm", "SilkwormService.GetClientUserInfo"),
    "get_user_max_redpack": ("RedPackService", "RedPackService.GetUserMaxRedPack"),
    "get_user_redpack_num": ("RedPackService", "RedPackService.GetUserRedPackNum"),
    "get_user_sign_in_days": ("SilkwormVip", "VipRightsService.UserSignInDays"),
    "get_user_task_v2": ("ActivityTask", "ActivityTaskMobileService.UserTaskV2"),
    "get_user_tencent_vip_info": ("SilkwormVip", "VipRightsService.UserTencentVipInfo"),
    "get_user_tencent_vip_list": ("SilkwormVip", "VipRightsService.UserTencentVipList"),
    "get_vip_prizes": ("SilkwormVip", "SilkwormVipMobile.VipPrizes"),
    "get_vip_rebate_info": ("SilkwormVip", "SilkwormVipMobile.GetVipRebateInfo"),
    "get_vip_task": ("SilkwormVip", "SilkwormVipMobile.GetVipTask"),
    "get_vip_up_gift": ("SilkwormMarketing", "SilkwormMobileMarketingService.GetUserUpVipGift"),
    "get_wait_claimed_points": ("ActivityTask", "ActivityTaskMobileService.WaitClaimedPoints"),
    "grab_brand_card": ("SilkwormVip", "VipRightsService.GrabBrandCard"),
    "grab_extra_brand_card": ("SilkwormVip", "VipRightsService.GrabExtraBrandCard"),
    "grab_free_order_quota": ("SilkwormVip", "VipRightsService.GrabFreeOrderQuota"),
    "grab_promotion_quota": ("SilkwormRcs", "SilkwormRcsService.MeituanShangjinRegisterEvent"),
    "grab_rebate_card_quota": ("SilkwormVip", "VipRightsService.GrabRebateCardQuota"),
    "grab_redpack_rain": ("SilkwormLottery", "SilkwormLotteryMobile.RedPackRainGrabNum"),
    "grab_tencent_vip_quota": ("SilkwormVip", "VipRightsService.GrabTencentVipQuota"),
    "incr_lottery_number": ("SilkwormMarketing", "SilkwormMobileMarketingService.UserIncrLotteryNumber"),
    "join_redpack_rain": ("SilkwormLottery", "SilkwormLotteryMobile.JoinRedPackRainEvent"),
    "list_flash_sale_exchanges": ("SilkwormCommunity", "SilkwormMobileCommunityService.ListFlashSaleExchanges"),
    "list_user_redpack": ("SilkwormLottery", "SilkwormLotteryMobile.ListUserRedPack"),
    "list_vip_gift_details": ("SilkwormMarketing", "SilkwormMobileMarketingService.ListVipGiftDetails"),
    "list_vip_gifts": ("SilkwormMarketing", "SilkwormMobileMarketingService.ListVipGifts"),
    "lottery_send_redpack": ("lottery", "PartnerPromotionService.LotterySendRedPack"),
    "receive_extra_lottery": ("SilkwormLottery", "SilkwormLotteryMobile.ReceiveExtraLottery"),
    "search_shangjin_stores": ("SilkwormRcs", "SilkwormRcsService.MeituanShangjinGetPoiList"),
    "search_stores": ("SilkwormFusion", "FusionService.SearchPromotions"),
    "set_all_messages_read": ("SilkwormMessageCenter", "MessageCenterService.SetMessageAllRead"),
    "sign_in_lottery": ("SilkwormVip", "VipRightsService.SignInLottery"),
    "today_exchange": ("SilkwormCommunity", "SilkwormMobileCommunityService.TodayExchange"),
    "use_free_order_card": ("SilkwormVip", "VipRightsService.UseFreeOrderCard"),
    "user_claim_points": ("ActivityTask", "ActivityTaskMobileService.UserClaimPoints"),
    "vip_prizes_lottery": ("SilkwormVip", "SilkwormVipMobile.VipPrizesLottery"),
    "wait_claimed_points": ("ActivityTask", "ActivityTaskMobileService.WaitClaimedPoints"),
}


def resolve(key: str) -> tuple[str, str]:
    """校验 key 是否在允许清单里，返回 (server, method)。"""
    try:
        return METHODS[key]
    except KeyError:
        raise ValueError(f"未知的小蚕方法：{key}") from None


def call(account: dict, key: str, body: dict[str, Any] | None = None, *,
         city_code: int | None = None) -> dict:
    """按 key 调网关：自动补 silk_id / user_id / app_id，其余参数由调用方给。"""
    server, method = resolve(key)
    silk_id = str(account.get("account_info") or "").strip()
    token = str(account.get("access_token") or "").strip()
    if not silk_id or not token:
        raise ValueError("账号缺少 silk_id 或 access_token，请先重新绑定")
    payload: dict[str, Any] = {"silk_id": int(silk_id)}
    if body:
        payload.update(body)
    payload.setdefault("app_id", ACTIVITY_APP_ID)
    return xc.xiaocan_rpc(
        server, method, payload,
        user_id=str(account.get("xc_user_id") or "0"),
        silk_id=silk_id,
        token=token,
        app_id=ACTIVITY_APP_ID,
        city_code=city_code if city_code is not None else account.get("city_code"),
    )
