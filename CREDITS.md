# 來源、授權與行為參考

專案自有程式採 [MIT License](LICENSE)。實際依賴的程式各自遵循其授權；行為參考另行標示。以下記錄本次 shell 整合涉及的來源，不是所有傳遞依賴的完整授權清單。

## just-bash：已採用於主終端

- 來源：[vercel-labs/just-bash](https://github.com/vercel-labs/just-bash)。
- 固定版本：`just-bash@3.6.0`，已納入 package.json 與 lockfile。主產品切換進度見 [驗證紀錄](docs/just-bash-progress.md)。
- 授權：[Apache License 2.0](https://github.com/vercel-labs/just-bash/blob/main/packages/just-bash/LICENSE)。
- 用途：接替自製 shell 的語法解析、執行與常用命令；接入本專案 IndexedDB VFS。
- [完整授權](public/licenses/just-bash-3.6.0-LICENSE.txt)（Copyright 2025 Vercel Inc.）、production 依賴全文與精確版本索引已加入 `public/licenses/`，隨 dist 發布。發行包未包含 NOTICE；保留 browser bundle 內的相依聲明；已對固定版 browser bundle 加上公開 result.cwd 的最小補丁，[修改聲明](public/licenses/just-bash-modifications.txt) 列出原始與修改後雜湊，安裝／建置／測試會驗證完整原始產物。`node:zlib` 的瀏覽器限制由本專案 shim 明確回報不支援。

## Pi 套件：目前實際使用

- `@earendil-works/pi-agent-core@0.84.4` 與 `@earendil-works/pi-ai@0.84.4`。
- 來源：[earendil-works/pi](https://github.com/earendil-works/pi)。
- 授權：MIT；Copyright (c) 2025 Mario Zechner，完整內容見 [v0.84.4 LICENSE](https://github.com/earendil-works/pi/blob/v0.84.4/LICENSE)。
- 用途：模型／工具循環、模型與 provider 型別、請求轉換及工具參數驗證等。

上述套件已在 package.json 與程式 imports 中使用；[MIT 授權全文](public/licenses/pi-0.84.4-LICENSE.txt) 已隨 dist 發布，與產品操作方式的參考分開記錄。所有已安裝 production 依賴的版本、來源與授權全文見 [索引](public/licenses/index.html)；該清單包含未進入 browser bundle 的 Node／optional 依賴，是發行程式的超集。

## Pi-like／Herdr-like：行為參考

依本專案設計說明，Pi-like 的輕量 agent 操作方式、Herdr-like 的多 tab 與跨 tab 溝通方式，是依產品行為自行實作的設計參考。此處作為致謝，不表示採用其完整產品實作、存在官方合作或獲得背書。

這項行為參考說明不取代上方實際 Pi 套件的 MIT 授權聲明。
