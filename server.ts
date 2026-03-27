import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import { google } from "googleapis";
import { stringify } from "csv-stringify/sync";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- CẤU HÌNH GOOGLE SHEETS API VỚI 2 LINK RIÊNG BIỆT ---
const LOG_SPREADSHEET_ID = "1Muqg0jhFinGl-loI7Vlkyf9d4qdMOgwtLT7gZhVmfoQ";
const DATA_SPREADSHEET_ID = "1FJ64lBMg-3ubBzA7hXFtD4aFEzEKQgLX10atFXCAiDY";

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    // Xử lý ký tự xuống dòng (\n) cho private key khi chạy trên Vercel
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

// --- CÁC HÀM HỖ TRỢ ĐỌC/GHI GOOGLE SHEETS ---

// Hàm đọc dữ liệu từ Sheet (truyền vào ID của file tương ứng)
// Sử dụng dải ô "A:Z" sẽ tự động lấy dữ liệu ở Sheet (Trang tính) đầu tiên
async function getSheetData(spreadsheetId: string) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: "A:Z", 
  });
  
  const rows = response.data.values;
  if (!rows || rows.length === 0) return [];
  
  const headers = rows[0];
  return rows.slice(1).map(row => {
    const obj: any = {};
    headers.forEach((header, i) => {
      obj[header] = row[i] || "";
    });
    return obj;
  });
}

// Hàm ghi Log nối tiếp vào cuối file Activity Log
async function writeLog(user: string, action: string, details: string) {
  const timestamp = new Date().toISOString();
  await sheets.spreadsheets.values.append({
    spreadsheetId: LOG_SPREADSHEET_ID,
    range: "A:D", // Cột A: Thời gian, B: User, C: Hành động, D: Chi tiết
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[timestamp, user, action, details]],
    },
  });
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(cors());
  app.use(express.json());

  // --- API ROUTES ---

  app.get("/api/data", async (req, res) => {
    try {
      const records = await getSheetData(DATA_SPREADSHEET_ID);
      res.json(records);
    } catch (error) {
      console.error("Lỗi đọc Dataset:", error);
      res.status(500).json({ error: "Failed to read data" });
    }
  });

  app.post("/api/data", async (req, res) => {
    try {
      const { data: newData, user, action, details } = req.body;
      
      if (newData && newData.length > 0) {
        const headers = Object.keys(newData[0]);
        const rows = newData.map((item: any) => headers.map(h => item[h]));
        const sheetValues = [headers, ...rows];

        // 1. Xóa dữ liệu cũ trên file Dataset
        await sheets.spreadsheets.values.clear({
          spreadsheetId: DATA_SPREADSHEET_ID,
          range: "A:Z",
        });

        // 2. Ghi đè dữ liệu mới vào file Dataset
        await sheets.spreadsheets.values.update({
          spreadsheetId: DATA_SPREADSHEET_ID,
          range: "A1",
          valueInputOption: "USER_ENTERED",
          requestBody: { values: sheetValues },
        });
      }
      
      if (user && action) {
        await writeLog(user, action, details || "");
      }
      
      res.json({ message: "Data saved successfully" });
    } catch (error) {
      console.error("Lỗi ghi Dataset:", error);
      res.status(500).json({ error: "Failed to save data" });
    }
  });

  app.get("/api/logs", async (req, res) => {
    const role = req.headers["x-user-role"];
    if (role !== "ADMIN") return res.status(403).json({ error: "Unauthorized" });

    try {
      const logs = await getSheetData(LOG_SPREADSHEET_ID);
      res.json(logs);
    } catch (error) {
      console.error("Lỗi đọc logs:", error);
      res.status(500).json({ error: "Failed to read logs" });
    }
  });

  // Export CSV cho Frontend tải về
  app.get("/api/export/data", async (req, res) => {
    try {
      const records = await getSheetData(DATA_SPREADSHEET_ID);
      const csvContent = stringify(records, { header: true });
      const bom = "\uFEFF";
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=dataset.csv");
      res.send(bom + csvContent);
    } catch (error) {
      res.status(500).send("Export failed");
    }
  });

  app.get("/api/export/logs", async (req, res) => {
    const role = req.headers["x-user-role"];
    if (role !== "ADMIN") return res.status(403).json({ error: "Unauthorized" });

    try {
      const logs = await getSheetData(LOG_SPREADSHEET_ID);
      const csvContent = stringify(logs, { header: true });
      const bom = "\uFEFF";
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=activity_log.csv");
      res.send(bom + csvContent);
    } catch (error) {
      res.status(500).send("Export failed");
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
