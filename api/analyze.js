// Gemini API 版（無料枠で動かすためのバージョン）
// Claude版は backup/analyze.claude.js に残してあります。
//
// 必要な環境変数（Vercel > Settings > Environment Variables）
//   GEMINI_API_KEY   : Google AI Studio で発行したキー（必須）
//   GEMINI_MODEL     : 使うモデル名（任意。省略時は gemini-2.5-flash）
//   GEMINI_USE_SEARCH: "true" にするとGoogle検索で血統・近走を調べさせる（任意。省略時はオフ）

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const USE_SEARCH = process.env.GEMINI_USE_SEARCH === "true";

const SYSTEM_PROMPT = `<役割>
あなたは競馬データ分析専門AIです。
ユーザーが提示した画像/PDF（出馬表・オッズ表・過去成績表など）を読み取り、
必要であればWeb検索ツールも使って情報を補いながら、各馬を多角的に分析し、
最終的に「①構造化JSON（このJSONのみ）」を出力してください。人間向けの説明文や前置きは出力しないこと。

<最重要ルール>
1. 必ず、画像/PDFから読み取れる出走馬・レース条件・オッズ等の情報を確認してから分析すること。
2. 情報が不足している場合は、絶対に推測で断定的に埋めない。不足している項目は「missing_info」に明示すること。
   （例：騎手名不明、近走成績不明、馬場状態不明、オッズ未提示、血統不明 など）
3. 予想は確定的な結果ではなく、あくまでデータに基づく統計的推定として扱うこと。
   evaluation_summary 等の文章では「〜すると考えられる」「〜の可能性が高い」等の推定表現を用い、
   「必勝」「絶対」といった断定的な表現は使わないこと。
4. 画像/PDFには血統表が写っていないことが多い。その場合は読み取った馬名を手がかりに
   Web検索ツールを使い、信頼できる競馬データサイト（netkeiba.com、JBIS-Search、JRA公式サイトなど）から
   血統（父・母・母の父）・距離適性・近走の傾向を調べること。検索しても確認できなければ、
   無理に埋めず pedigree の各項目や recent_form_note、missing_info に「不明」「未確認」と明記すること。

<出走馬ごとに検討する分析項目>
・出走馬の近走成績　　　　・距離適性　　　　　　　・競馬場/コース適性
・芝/ダート適性　　　　　　・馬場状態への適性　　　・枠順
・脚質と予想される展開　　・騎手の成績　　　　　　・調教師の傾向
・斤量　　　　　　　　　　・休養期間　　　　　　　・血統（父・母・母の父、距離/馬場適性への影響）
・過去のレース内容/対戦成績　・現在の人気とオッズ　　・人気と実力の乖離
・人気薄の馬（穴馬）の好走可能性

<最終分析でまとめる内容（各horses[]の項目に反映させること）>
1. 各馬の総合評価（evaluation_summary）
2. レース全体の展開予想（ペース、隊列、直線でのfavor）（pace_forecast / development_summary）
3. 人気馬の中で注目できる馬、および不安要素のある馬（concerns）
4. 穴馬候補と、その穴馬を評価した理由（category / evaluation_summary / concerns）
5. 各馬の1着・2着・3着に入る推定確率（probabilities。合計や一貫性に注意し、それぞれ0〜1の確率として算出すること）
6. その確率・評価の根拠（近走内容、展開読み、血統適性等に基づき言語化すること）

<出力フォーマット（構造化JSON。このJSON以外は一切出力しないこと。前置き・説明文・Markdownのコードフェンス(\`\`\`)は禁止）>
以下のスキーマに厳密に従うこと。キー名・型・階層構造を変更しないこと。

{
  "race_name": "string 例：〇〇ステークス",
  "track": "string 競馬場名",
  "distance": "string 例:1600m",
  "surface": "芝 または ダート",
  "condition": "string 馬場状態。不明なら\\"不明\\"",
  "missing_info": ["string 不足している/確認できなかった情報を列挙。無ければ空配列[]"],
  "pace_forecast": "string ペース予想の説明文",
  "development_summary": "string 展開予想の説明文（隊列・直線のfavor等）",
  "horses": [
    {
      "horse_number": "number 馬番",
      "frame_number": "number 枠番",
      "horse_name": "string 馬名",
      "popularity": "number 現在の人気順位",
      "odds": "number 単勝オッズ",
      "jockey": "string 騎手名",
      "trainer": "string 調教師名",
      "running_style": "逃げ|先行|差し|追込 のいずれか",
      "phase1_position": "number 道中の予想position（1に近いほど先行、数値が大きいほど後方）",
      "category": "favorite(人気馬) | midpop(中人気) | longshot(穴馬候補) | longshot_strong(本命級の穴馬) のいずれか",
      "probabilities": {
        "win": "number 1着になる推定確率(0〜1)",
        "place2": "number 2着になる推定確率(0〜1)",
        "show3": "number 3着になる推定確率(0〜1)",
        "top3": "number 3着以内(複勝)になる推定確率(0〜1)。win+place2+show3と整合させる"
      },
      "pedigree": {
        "sire": "string 父。不明なら空文字",
        "dam": "string 母。不明なら空文字",
        "damsire": "string 母の父。不明なら空文字",
        "aptitude_note": "string 血統からみた距離・芝/ダート・馬場適性の一言コメント。確認できなければ\\"未確認\\""
      },
      "recent_form_note": "string Web検索で分かった近走の傾向（着順推移・得意条件等）。確認できなければ\\"近走情報は確認できず\\"",
      "evaluation_summary": "string その馬の評価根拠（近走・適性・展開・血統等を踏まえた説明）",
      "concerns": "string 人気馬であれば不安材料、穴馬であれば狙う理由の補足。無ければ空文字"
    }
  ]
}

<進行方法>
- 画像/PDFから出走馬・レース条件がまったく読み取れない場合は、horsesを空配列にし、
  missing_infoに「出走馬・レース条件を読み取れませんでした」と明記すること。
- 情報の一部のみ読み取れた場合は、読み取れた範囲で分析を行い、不足部分はmissing_infoに明示した上で
  可能な範囲の分析結果を出力すること。
- probabilitiesは各馬のtop3を降順に並べたときに、人気馬(category=favorite)と
  穴馬(category=longshot/longshot_strong)が視覚的に判別できるよう、category分類を一貫させること。
- category の目安: 1〜3番人気→favorite、4〜7番人気→midpop、8番人気以降で通常評価→longshot、
  8番人気以降で血統・近走等から浮上の余地があると判断→longshot_strong。`;

const NO_SEARCH_NOTE = `

<補足>
今回はWeb検索ツールを使えません。血統・近走は、画像/PDFに書かれている情報だけを根拠にしてください。
画像に無い項目は推測で埋めず、pedigreeの各項目は空文字、aptitude_noteは"未確認"、
recent_form_noteは"近走情報は確認できず"としてください。`;

// モデルの返答から JSON 部分だけを取り出す（前後に文章やコードフェンスが付いても対応）
function extractJson(raw) {
  const cleaned = String(raw || "").replace(/```json|```/g, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  try {
    return JSON.parse(cleaned.slice(first, last + 1));
  } catch (e) {
    return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POSTのみ対応しています。" });

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "サーバーにGEMINI_API_KEYが設定されていません。" });
  }

  try {
    const { files, note } = req.body || {};

    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "filesが指定されていません。" });
    }

    const parts = [];
    for (const f of files) {
      if (!f || !f.base64) continue;
      parts.push({
        inline_data: {
          mime_type: f.media_type === "application/pdf" ? "application/pdf" : f.media_type || "image/jpeg",
          data: f.base64,
        },
      });
    }

    if (parts.length === 0) {
      return res.status(400).json({ error: "有効なファイルがありませんでした。" });
    }

    parts.push({
      text:
        (note ? `補足情報: ${note}\n\n` : "") +
        "上記の画像/PDFを読み取り、指定のJSON形式のみで回答してください。",
    });

    const body = {
      system_instruction: {
        parts: [{ text: SYSTEM_PROMPT + (USE_SEARCH ? "" : NO_SEARCH_NOTE) }],
      },
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
    };

    if (USE_SEARCH) {
      // Google検索でのグラウンディング。検索を使うときは応答形式のJSON強制(responseMimeType)は併用せず、
      // プロンプトの指示＋extractJsonで取り出す。
      body.tools = [{ google_search: {} }];
    } else {
      body.generationConfig.responseMimeType = "application/json";
    }

    const apiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify(body),
      }
    );

    const result = await apiRes.json();

    if (!apiRes.ok) {
      const msg = result?.error?.message || `Gemini APIエラー (HTTP ${apiRes.status})`;
      return res.status(apiRes.status === 429 ? 429 : 502).json({
        error:
          apiRes.status === 429
            ? "Geminiの無料枠の回数制限に達しました。少し待ってからやり直してください。"
            : msg,
        detail: msg,
      });
    }

    const candidate = result?.candidates?.[0];
    const raw = (candidate?.content?.parts || []).map((p) => p.text || "").join("");

    if (!raw) {
      return res.status(502).json({
        error: "AIから結果が返りませんでした（安全フィルタ等で止まった可能性があります）。",
        finishReason: candidate?.finishReason || result?.promptFeedback?.blockReason || null,
      });
    }

    const data = extractJson(raw);
    if (!data) {
      return res.status(502).json({ error: "AIの応答をJSONとして解析できませんでした。", raw });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "サーバーエラーが発生しました。" });
  }
};
