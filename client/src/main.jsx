import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css"; // <-- THIS is the missing piece

createRoot(document.getElementById("root")).render(<App />);
