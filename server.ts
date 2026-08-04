import express from "express";
import path from "path";
import fs from "fs";
import readline from "readline";
import { createServer as createViteServer } from "vite";
import gplay from "google-play-scraper";
import { Stemmer } from "sastrawijs";

const stemmer = new Stemmer();

async function stemWithSastrawi(tokensList: string[][]): Promise<string[][]> {
  return tokensList.map(tokens => 
    tokens.map(token => stemmer.stem(token))
  );
}

interface CompiledNormDict {
  singleWordMap: Map<string, string>;
  multiWordList: { regex: RegExp; key: string; val: string }[];
}

let cachedNormDict: CompiledNormDict | null = null;

function getCompiledNormDict(): CompiledNormDict {
  if (cachedNormDict) return cachedNormDict;

  const singleWordMap = new Map<string, string>();
  const multiWordList: { regex: RegExp; key: string; val: string }[] = [];

  const files = [
    path.join(process.cwd(), "kamus_kata_tidak_baku_ai_studio_clean.csv"),
    path.join(process.cwd(), "kamuskatabaku_ai_studio.csv")
  ];

  for (const filePath of files) {
    if (fs.existsSync(filePath)) {
      try {
        const fileData = fs.readFileSync(filePath, "utf-8");
        const lines = fileData.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          if (i === 0 && (line.toLowerCase().includes("tidak baku") || line.toLowerCase().includes("kata baku"))) {
            continue;
          }

          let key = "";
          let value = "";

          if (line.includes(";")) {
            const parts = line.split(";");
            key = (parts[0] || "").trim().toLowerCase();
            value = (parts[1] || "").trim().toLowerCase();
          } else if (line.includes(",")) {
            const parts = line.split(",");
            key = (parts[0] || "").trim().toLowerCase();
            value = (parts[1] || "").trim().toLowerCase();
          }

          if (key && value && key !== "kata tidak baku") {
            if (key.includes(" ")) {
              const regex = new RegExp(`\\b${key.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'gi');
              multiWordList.push({ regex, key, val: value });
            } else {
              if (!singleWordMap.has(key)) {
                singleWordMap.set(key, value);
              } else if (singleWordMap.get(key) !== key && value === key) {
                singleWordMap.set(key, value);
              }
            }
          }
        }
      } catch (err) {
        console.error(`Error loading normalization dictionary file ${filePath}:`, err);
      }
    }
  }

  cachedNormDict = { singleWordMap, multiWordList };
  return cachedNormDict;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API route for scraping
  app.post("/api/scrape", async (req, res) => {
    try {
      const { appId, limit } = req.body;
      if (!appId) {
        return res.status(400).json({ error: "appId is required" });
      }
      
      const numLimit = parseInt(limit, 10) || 100;
      
      const options = {
        appId: appId,
        sort: (gplay as any).sort.NEWEST,
        num: numLimit > 3000 ? 3000 : numLimit, // gplay scraper limit
        lang: 'id',
        country: 'id'
      };

      let appName = appId;
      try {
        const appDetail = await gplay.app({ appId, lang: 'id', country: 'id' });
        if (appDetail && appDetail.title) {
          appName = appDetail.title;
        }
      } catch (e) {
        // fallback
      }

      const reviews = await gplay.reviews(options);
      
      res.json({ success: true, data: reviews.data, appName, appId });
    } catch (error) {
      console.error("Scraping error:", error);
      res.status(500).json({ error: "Gagal mengambil data dari Google Play Store" });
    }
  });

  // API route for preprocessing
  app.post("/api/preprocess", express.json({ limit: '50mb' }), async (req, res) => {
    try {
      const { data } = req.body;
      if (!data || !Array.isArray(data)) {
        return res.status(400).json({ error: "Invalid data format" });
      }

      // Stopwords - explicitly removing negations (tidak, belum) from stopwords for sentiment analysis
      const stopwords = new Set(["https", "co", "rt", "amp", "lu", "deh", "t", "fyp", "ya", "gue", "sih", "yang", "dan", "di", "ke", "dari", "ini", "itu", "untuk", "pada", "dengan", "nya", "buat", "adalah", "saya", "kamu", "kami", "mereka", "kita", "bisa", "akan", "sudah", "telah"]);

      // Compiled Normalization dictionary loaded ONCE from primary CSV sources
      const { singleWordMap, multiWordList } = getCompiledNormDict();

      let currentData = [...data];
      const initialCount = currentData.length;

      // A. Remove duplicates based on 'text'
      const seenTexts = new Set();
      currentData = currentData.filter(r => {
        const t = r.text || '';
        if (seenTexts.has(t)) return false;
        seenTexts.add(t);
        return true;
      });
      const afterDuplicateCount = currentData.length;

      // calculate words before
      const allTextBefore = currentData.map(r => r.text || '').join(" ");
      const wordsBeforeList = allTextBefore.split(/\s+/).filter(w => w);
      const numWordsBefore = wordsBeforeList.length;
      const uniqueWordsBefore = new Set(wordsBeforeList).size;

      let normCount = 0;
      let totalTokens = 0;
      let tokensAfterStopword = 0;
      let stemChangeCount = 0;

      // Process pipeline up to Stopword Removal
      const stopwordTokensList: string[][] = [];
      const intermediateRows = currentData.map(r => {
        // C. Cleaning
        let originalText = r.text || '';
        let cleaning = originalText
          .replace(/https?:\/\/\S+|www\.\S+/g, '') // url
          .replace(/<.*?>/g, '') // html
          .replace(/[^\w\s]/gi, ' ') // symbols
          .replace(/\d+/g, '') // numbers
          .replace(/\s+/g, ' ').trim(); // extra spaces

        // D. Case Folding
        let caseFolding = cleaning.toLowerCase();

        // E. Normalisasi (dilakukan setelah Case Folding dan sebelum Tokenization)
        let textToNormalize = caseFolding;
        for (const item of multiWordList) {
          if (textToNormalize.includes(item.key)) {
            textToNormalize = textToNormalize.replace(item.regex, () => {
              normCount++;
              return item.val;
            });
          }
        }
        let words = textToNormalize.split(/\s+/).filter(w => w);
        let normalisasi = words.map(w => {
          const replacement = singleWordMap.get(w);
          if (replacement) {
            normCount++;
            return replacement;
          }
          return w;
        }).join(" ");

        // F. Tokenization
        let tokenizationArr = normalisasi.split(/\s+/).filter(w => w);
        totalTokens += tokenizationArr.length;
        let tokenization = `[${tokenizationArr.map(w => `'${w}'`).join(', ')}]`;

        // G. Stopword Removal
        let stopwordArr = tokenizationArr.filter(w => !stopwords.has(w));
        tokensAfterStopword += stopwordArr.length;
        let stopword = `[${stopwordArr.map(w => `'${w}'`).join(', ')}]`;

        stopwordTokensList.push(stopwordArr);

        return { 
          ...r, 
          originalText, 
          cleaning, 
          caseFolding, 
          normalisasi, 
          tokenization, 
          stopword,
          stopwordArr
        };
      });

      // H. Stemming via Sastrawi Stemmer
      const stemmedTokensList = await stemWithSastrawi(stopwordTokensList);

      currentData = intermediateRows.map((r, idx) => {
        const stopwordArr: string[] = r.stopwordArr;
        const stemArr: string[] = stemmedTokensList[idx] || stopwordArr;

        for (let j = 0; j < Math.max(stopwordArr.length, stemArr.length); j++) {
          if (stopwordArr[j] !== stemArr[j]) {
            stemChangeCount++;
          }
        }

        const stemming = stemArr.join(" ");

        const rowCopy = { ...r, stemming };
        delete (rowCopy as any).stopwordArr;

        return rowCopy;
      });

      // I. Hapus Kosong
      let beforeEmptyCount = currentData.length;
      currentData = currentData.filter(r => r.stemming.trim() !== "");
      let afterEmptyCount = currentData.length;

      // calculate words after
      const allTextAfter = currentData.map(r => r.stemming).join(" ");
      const wordsAfterList = allTextAfter.split(/\s+/).filter(w => w);
      const numWordsAfter = wordsAfterList.length;
      const uniqueWordsAfter = new Set(wordsAfterList).size;

      // WordCloud Before (up to 500)
      const countBefore: Record<string, number> = {};
      const ignoreWords = new Set(["https", "co", "rt", "...", "amp", "dan", "yang", "di", "ke", "dari", "ini", "itu", "untuk", "pada", "dengan", "adalah"]);
      wordsBeforeList.forEach(w => { 
        const lw = w.toLowerCase();
        if (!ignoreWords.has(lw)) {
          countBefore[lw] = (countBefore[lw] || 0) + 1; 
        }
      });
      const sortedBefore = Object.entries(countBefore).sort((a,b) => b[1]-a[1]);
      const topBefore = sortedBefore.slice(0, 10).map(e => ({ name: e[0], value: e[1] }));
      const wordCloudBefore = sortedBefore.slice(0, 500).map(e => ({ text: e[0], value: e[1] }));

      // WordCloud After (up to 500)
      const countAfter: Record<string, number> = {};
      const ignoreWordsAfter = new Set(["https", "co", "rt", "...", "amp", "lu", "deh", "t", "fyp", "ya", "gue", "sih"]);
      wordsAfterList.forEach(w => { 
        if (!ignoreWordsAfter.has(w)) {
          countAfter[w] = (countAfter[w] || 0) + 1; 
        }
      });
      const sortedAfter = Object.entries(countAfter).sort((a,b) => b[1]-a[1]);
      const topAfter = sortedAfter.slice(0, 10).map(e => ({ name: e[0], value: e[1] }));
      const wordCloudAfter = sortedAfter.slice(0, 500).map(e => ({ text: e[0], value: e[1] }));

      const stats = {
        initialCount, afterDuplicateCount, beforeEmptyCount, afterEmptyCount,
        numWordsBefore, uniqueWordsBefore, numWordsAfter, uniqueWordsAfter,
        topBefore, topAfter, wordCloudBefore, wordCloudAfter, normCount, totalTokens, tokensAfterStopword, stemChangeCount
      };

      res.json({ success: true, stats, rows: currentData });
    } catch (error) {
      console.error("Preprocessing error:", error);
      res.status(500).json({ error: "Gagal memproses data NLP" });
    }
  });
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
