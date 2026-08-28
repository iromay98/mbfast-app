-- 文体選択と、マップ投稿の清書文の保存。
-- 音声入力の生文（誤変換・場所描写入り）がそのままGoogleマップに公開された
-- 事故（2026-08-28 マセラティ）を受け、マップ投稿もAI清書を必須にする。
-- 清書文はPitPostに保存し、再投稿時にメモの生文へ戻らないようにする。
ALTER TABLE "PitStore" ADD COLUMN "writingTone" TEXT NOT NULL DEFAULT 'polite';
ALTER TABLE "PitPost"  ADD COLUMN "mapPostText" TEXT;
