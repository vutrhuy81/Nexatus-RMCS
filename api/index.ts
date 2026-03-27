import express from "express";
import cors from "cors";
import { google } from "googleapis";
import { stringify } from "csv-stringify/sync";

const app = express();
app.use(cors());
app.use(express.json());

// --- CẤU HÌNH GOOGLE SHEETS API ---
const LOG_SPREADSHEET_ID = "1Muqg0jhFinGl-loI7Vlkyf9d4qdMOgwtLT7gZhVmfoQ";
const DATA_SPREADSHEET_ID = "1FJ64lBMg-3ubBzA7hXFtD4aFEzEKQgLX10atFXCAiDY";

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

// --- CÁC HÀM HỖ TRỢ ---
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

async function writeLog(user: string, action: string, details: string) {
  const timestamp = new Date().toISOString();
  await sheets.spreadsheets.values.append({
    spreadsheetId: LOG_SPREADSHEET_ID,
    range: "A:D",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[timestamp, user, action, details]],
    },
  });
}

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

      await sheets.spreadsheets.values.clear({
        spreadsheetId: DATA_SPREADSHEET_ID,
        range: "A:Z",
      });

      await sheets.spreadsheets.values.update({
        spreadsheetId: DATA_SPREADSHEET_ID,
        range: "A1",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: sheetValues },
      });
    }
    
    if (user && action) await writeLog(user, action, details || "");
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
    res.status(500).json({ error: "Failed to read logs" });
  }
});

app.get("/api/export/data", async (req, res) => {
  try {
    const records = await getSheetData(DATA_SPREADSHEET_ID);
    const csvContent = stringify(records, { header: true });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=dataset.csv");
    res.send("\uFEFF" + csvContent);
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
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=activity_log.csv");
    res.send("\uFEFF" + csvContent);
  } catch (error) {
    res.status(500).send("Export failed");
  }
});

// LỆNH QUAN TRỌNG NHẤT ĐỂ VERCEL HIỂU ĐÂY LÀ BACKEND
export default app;
