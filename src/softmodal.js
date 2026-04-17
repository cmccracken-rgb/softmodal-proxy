// src/softmodal.js

export async function fetchQuote({ origin, destination, size }) {
  try {
    console.log("=== START fetchQuote ===");
    console.log({ origin, destination, size });

    const url = "https://softmodal.com/rates/dtd";

    const params = new URLSearchParams({
      request_id: "test123",
      truck_mode: "van",
      tarps: "false",
      dray_date: "18",
      hybrid_rates: "0",
      valid: new Date().toISOString().split("T")[0],
      restricted: "false",
      o_stay: "true",
      o_drop: "true",
      o_oneway: "true",
      d_stay: "true",
      d_drop: "true",
      d_oneway: "true",
      o_stop: "false",
      d_stop: "false",
      priv: "false",
      empty: "false",
      hazardous: "false",
      embargoed: "30",
      o_days: "2",
      d_days: "2",
      placeholder: "0",
      dray_rate_flag: "5",
      mileage_routing: "practical",
      tipe: "imc",
      add_dray_rate: "1",
      s28: "",
      origin,
      destination,
      size,
      _: Date.now().toString()
    });

    const fullUrl = `${url}?${params.toString()}`;

    console.log("Request URL:", fullUrl);

    const response = await fetch(fullUrl, {
      method: "GET",
      headers: {
        "accept": "*/*",
        "user-agent": "Mozilla/5.0",
        "cookie": process.env.SOFTMODAL_COOKIE || ""
      }
    });

    console.log("Status:", response.status);

    const text = await response.text();

    console.log("Raw response:", text.slice(0, 500));

    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }

  } catch (err) {
    console.error("FATAL ERROR:", err);
    throw err;
  }
}
