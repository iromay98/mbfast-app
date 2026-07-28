# ナンバープレート検出モデル置き場

`plate-detect.onnx` をこのディレクトリに置くと、mbPIT投稿UIの
ナンバープレート自動モザイクが有効になります（未設置の間は手動モザイクのみ）。

要件:
- YOLOv5/YOLOv8系の1クラス（license-plate）検出モデルをONNXエクスポートしたもの
- 入力: 640x640 RGB (letterbox)。出力: [1,5,8400](v8) または [1,25200,6](v5)
- サイズ目安: 数MB（yolov8n/yolov5n相当）

【ライセンス注意】Ultralytics(YOLOv5/v8)由来の学習済みモデルは AGPL-3.0 のため、
商用アプリへの同梱には Ultralytics のライセンス購入等が必要。本部で確認のうえ配置すること。
