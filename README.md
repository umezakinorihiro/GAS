# 概要
GASとgeminiを利用してレシートをスプレッドシートに追加するコードの一部です。
scriptIdが入っているコード（.clasp.json）はアップしておりません。

# 注意  
スプレッドシートのappScriptにGEMINI_API_KEYとSHEET_IDを追加してください。
それぞれ個人的に取得する必要があるため、取得方法はネットで調べてください。　　
main.jsはmain.tsからファイル生成されるのでダウンロードしなくてもいいです。

# GAS + TypeScript + clasp サンプル（Upload.html）

Google Apps Script を TypeScript で開発し、`clasp` で push する構成です。  
`Upload.html` は HTML Service の画面として利用します。

---

## 1. 前提条件

- Node.js
- Googleアカウント
- Google Apps Script API を有効化
- clasp をインストール

### clasp インストール
```bash
npm i -g @google/clasp
clasp -v

---

