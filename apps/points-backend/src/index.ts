import "dotenv/config";
import app from "./app.js";

const PORT = parseInt(process.env.PORT || "3004", 10);

app.listen(PORT, () => {
  console.log(`Points Backend on :${PORT}`);
});
