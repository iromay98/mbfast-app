-- チューンド車用: 本店が事前アップする純正(ori)bin（代理店が ori .slave でDLできる）
ALTER TABLE "ServiceRecord" ADD COLUMN "oriFilePath" TEXT;
ALTER TABLE "ServiceRecord" ADD COLUMN "oriFileName" TEXT;
ALTER TABLE "ServiceRecord" ADD COLUMN "oriFileHash" TEXT;
