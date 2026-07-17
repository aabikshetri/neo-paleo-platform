import { BrowserRouter, Routes, Route } from "react-router-dom";

import Navbar from "./components/layout/Navbar";
import Footer from "./components/layout/Footer";

import DatasetExplorer from "./pages/DatasetExplorer";

function App() {
  return (
    <BrowserRouter>

      <Navbar />

      <Routes>

        <Route
          path="/"
          element={<DatasetExplorer />}
        />

      </Routes>

      <Footer />

    </BrowserRouter>
  );
}

export default App;
