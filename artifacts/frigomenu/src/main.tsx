import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
const res = await fetch("http://localhost:3000/create-checkout-session", {
  method: "POST",
});

const data = await res.json();
window.location.href = data.url;
