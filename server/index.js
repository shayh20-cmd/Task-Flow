import { createApp } from './app.js';

const port = Number(process.env.PORT) || 3000;
const { app } = createApp({ dataDir: process.env.RECIPIN_DATA || undefined });

app.listen(port, () => {
  console.log(`Recipin פועל: http://localhost:${port}`);
  if (!process.env.RECIPIN_PASSWORD) console.log('טיפ: הגדירו RECIPIN_PASSWORD כדי להגן על העריכה בסיסמה.');
});
