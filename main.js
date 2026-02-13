"use strict";
/**
 * Webアプリ入口
 */
function doGet() {
    return HtmlService.createHtmlOutputFromFile("Upload")
        .setTitle("画像アップロード WebApp");
}
/**
 * 勘定科目（ざっくり推定：AIが空/不正のときの保険）
 * ※必要に応じてキーワードを増やしてください
 */
function guessAccount(itemName) {
    const s = (itemName || "").toLowerCase();
    // 割引系
    if (s.includes("会計割引") || s.includes("割引") || s.includes("値引") || s.includes("クーポン")) {
        return "値引（控除）";
    }
    // 交通
    const transportWords = ["suica", "pasmo", "電車", "バス", "タクシー", "ガソリン", "高速"];
    if (transportWords.some(w => s.includes(w)))
        return "旅費交通費";
    // 通信
    const commWords = ["通信", "スマホ", "携帯", "回線", "wifi", "インターネット"];
    if (commWords.some(w => s.includes(w)))
        return "通信費";
    // 仕入っぽい（食品・飲料）
    const foodWords = ["パン", "おにぎり", "弁当", "コーヒー", "お茶", "牛乳", "ヨーグルト", "菓子", "チョコ", "アイス", "ジュース", "米", "肉", "魚", "野菜"];
    if (foodWords.some(w => s.includes(w)))
        return "仕入高";
    // 消耗品っぽい
    const dailyWords = ["袋", "マスク", "洗剤", "ティッシュ", "トイレット", "ラップ", "電池", "歯ブラシ", "シャンプー", "タオル", "スポンジ", "ゴミ袋"];
    if (dailyWords.some(w => s.includes(w)))
        return "消耗品費";
    return "雑費";
}
/**
 * メイン処理
 * - レシート画像(base64 JPEG)をGeminiに投げる
 * - { 購入日付, 明細[] } のJSONを返させる（勘定科目・用途も）
 * - スプレッドシートへ
 *   [timestamp, 商品名, 元値, 割引額, 最終金額, 購入日付, 想定勘定科目, 用途] を追記
 */
function processImage(base64) {
    const props = PropertiesService.getScriptProperties();
    const apiKey = props.getProperty("GEMINI_API_KEY");
    const sheetId = props.getProperty("SHEET_ID");
    if (!apiKey || !sheetId) {
        throw new Error("Script Properties が未設定です（GEMINI_API_KEY / SHEET_ID）");
    }
    // ===== 無料枠対策：画像サイズ制限 =====
    const MAX_BASE64_SIZE = 1500000; // 約1MB（base64文字数でざっくり制限）
    if (base64.length > MAX_BASE64_SIZE) {
        throw new Error("画像サイズが大きすぎます（無料枠対策）");
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
    const payload = {
        contents: [
            {
                parts: [
                    {
                        text: `
以下のレシート画像から情報を抽出してください。
必ず「JSONのみ」を返してください（余計な文章・コードブロック禁止）。

【前提】
- 本レシートは事業経費（宿運営/業務）として整理します。
- 宿用と仕事用が混在するため、「用途」も推定してください。

【勘定科目ルール（必須）】
- 勘定科目は次の候補から必ず1つ選ぶ（新しい科目名を作らない）:
["仕入高","消耗品費","旅費交通費","通信費","支払手数料","会議費","接待交際費","広告宣伝費","修繕費","雑費","値引（控除）"]

【用途ルール（必須）】
- 用途は次の候補から必ず1つ選ぶ:
["宿","仕事","共通","未分類"]

【判断基準（例）】
- 食材/飲料/客に提供するもの → 仕入高（用途=宿）
- アメニティ/清掃用品/雑貨/文具 → 消耗品費（用途=宿 or 共通）
- 電車/バス/タクシー/ガソリン/高速 → 旅費交通費（用途=仕事が多い）
- 通信/スマホ/回線 → 通信費
- 会計割引/値引/クーポン → 値引（控除）
- 迷う場合は「雑費」または「未分類」を選ぶ

【値引の扱い】
- 値引きが別行（例: 値引 -20）で出る場合は、原則「直前の商品」に紐づけてその商品の割引に入れる。
- 会計全体の割引しか分からない場合は、商品名="会計割引" として1行追加し、支払金額=割引額(マイナス)で返す。

【返却JSON形式】
{
  "購入日付": string | null,
  "明細": [
    {
      "商品名": string | null,
      "金額": number | null,
      "割引": number | null,
      "支払金額": number | null,
      "想定勘定科目": "仕入高"|"消耗品費"|"旅費交通費"|"通信費"|"支払手数料"|"会議費"|"接待交際費"|"広告宣伝費"|"修繕費"|"雑費"|"値引（控除）",
      "用途": "宿"|"仕事"|"共通"|"未分類"
    }
  ]
}
`,
                    },
                    {
                        inline_data: {
                            mime_type: "image/jpeg",
                            data: base64,
                        },
                    },
                ],
            },
        ],
    };
    const options = {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
    };
    const sheet = SpreadsheetApp.openById(sheetId).getActiveSheet();
    const timestamp = new Date();
    // ===== Gemini API 呼び出し =====
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    const body = response.getContentText();
    if (code !== 200) {
        throw new Error(`Gemini API Error (${code}): ${body}`);
    }
    const data = JSON.parse(body);
    if (!data.candidates?.length) {
        throw new Error("Gemini response is empty");
    }
    const text = data.candidates[0].content.parts[0].text;
    // ===== JSON抽出（保険：```json ... ``` で返ってくることがある）=====
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    const extracted = match ? JSON.parse(match[1]) : JSON.parse(text);
    const purchaseDate = extracted["購入日付"] ?? "";
    const items = extracted["明細"];
    if (!Array.isArray(items)) {
        throw new Error("明細が配列ではありません: " + JSON.stringify(extracted));
    }
    // ===== 許容値ガード（AIの出力ブレ対策）=====
    const ALLOWED_ACCOUNTS = new Set([
        "仕入高", "消耗品費", "旅費交通費", "通信費", "支払手数料",
        "会議費", "接待交際費", "広告宣伝費", "修繕費", "雑費", "値引（控除）",
    ]);
    const ALLOWED_USE = new Set(["宿", "仕事", "共通", "未分類"]);
    // ===== スプレッドシート追記（A〜H）=====
    // A: timestamp（アップロード時刻）
    // B: 商品名
    // C: 元値
    // D: 割引額（正の値表示）
    // E: 最終金額
    // F: 購入日付（レシート記載）
    // G: 想定勘定科目
    // H: 用途
    items.forEach((item) => {
        const name = item.商品名 ?? "";
        const gross = item.金額 ?? null; // 元値
        const discount = item.割引 ?? 0; // マイナス想定
        const paid = item.支払金額 ?? (gross !== null ? gross + discount : null);
        const discountAbs = discount ? Math.abs(discount) : 0;
        const accRaw = (item.想定勘定科目 ?? "").trim();
        const account = ALLOWED_ACCOUNTS.has(accRaw) ? accRaw : guessAccount(name);
        const useRaw = (item.用途 ?? "").trim();
        const use = ALLOWED_USE.has(useRaw) ? useRaw : "未分類";
        sheet.appendRow([
            timestamp,
            name,
            gross ?? "",
            discountAbs ?? "",
            paid ?? "",
            purchaseDate ?? "",
            account ?? "",
            use ?? "",
        ]);
    });
    return extracted;
}
