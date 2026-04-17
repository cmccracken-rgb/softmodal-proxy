import express from "express";

const app = express();

app.get("/", (req, res) => {
  res.send("SERVER IS WORKING");
});

app.get("/quote", (req, res) => {
  res.json({ ok: true });
});

app.listen(3000, () => {
  console.log("Server running");
});
