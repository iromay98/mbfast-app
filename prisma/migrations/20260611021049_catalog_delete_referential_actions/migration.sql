-- DropForeignKey
ALTER TABLE "TunedVariantVersion" DROP CONSTRAINT "TunedVariantVersion_variantId_fkey";

-- AddForeignKey
ALTER TABLE "TunedVariantVersion" ADD CONSTRAINT "TunedVariantVersion_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "TunedVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
