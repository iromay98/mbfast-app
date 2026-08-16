-- 送料を「方式 × 地域」の表で持つ（AT One / IXI Flasher / ECU郵送で荷姿が違うため）
ALTER TABLE "ShopSetting" ADD COLUMN "shippingMatrix" JSONB NOT NULL DEFAULT '{}';
