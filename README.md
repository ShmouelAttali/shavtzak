# שבצק — מערכת לוז חיילים

## Setup

### 1. Google Sheets API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use an existing one)
3. Enable **Google Sheets API** under APIs & Services → Library
4. Create an API key under APIs & Services → Credentials
5. (Recommended) Restrict the key to the Sheets API only

### 2. Make the sheet accessible

The sheet must be shared with **"Anyone with the link can view"** OR the API key must belong to a service account that has access.

### 3. Local development

```bash
cp .env.example .env
# fill in your GOOGLE_SHEETS_API_KEY
```

Run with Vercel CLI (recommended — runs both the API and the frontend):
```bash
npx vercel dev
```

Or run just the frontend (API calls will fail without the backend):
```bash
npm run dev
```

### 4. Deploy to Vercel

```bash
npx vercel
```

Set the following environment variables in the Vercel project settings:
- `GOOGLE_SHEETS_API_KEY` — your API key
- `GOOGLE_SHEET_ID` — (optional, defaults to the configured ID)

## Sheet structure expected

The sheet `מצבת החיילים` should have:

| Row | Content |
|-----|---------|
| 1 | Column headers: `מספר אישי`, `שם פרטי`, `שם משפחה`, `פלאפון`, `תפקיד`, `מחלקה`, `הערות`, … and date columns like `21/06/26` |
| 2 | Date row (same dates) |
| 3 | Day names in Hebrew (יום ראשון, יום שני, …) |
| 4+ | Soldier rows |

Date format in column headers: `DD/MM/YY` (e.g. `21/06/26` = June 21, 2026)

Status values recognized:
- `נוכח` — green
- `חופש` — blue  
- `שחרור` / `שחרר` — purple
- `לא מגיע` — red
- `יציאה בערב` — orange
