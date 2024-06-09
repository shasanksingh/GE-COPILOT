import React, { createContext, useEffect, useLayoutEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import { useSelector } from "react-redux";
import ProtectedRoute from "./protected";
import Loading from "./components/loading/loading";
import instance from "./config/instance";
import { Menu } from "./components";
import { Error, Forgot, Login, Main, Signup } from "./page";
import Switch from "react-switch";
import "./index.scss"
// import {Sun1 , } from "./assets";

// Create a context for documents
export const documentsContext = createContext({
  documents: [],
  setDocuments: () => {},
  getFiles: () => {},
});

const App = () => {
  const [offline, setOffline] = useState(!window.navigator.onLine);
  const [file_id, set_file_id] = useState(null);
  const { loading, user } = useSelector((state) => state);
  const [documents, setDocuments] = useState([]);
  const { _id } = useSelector((state) => state.messages);

  // State for dark mode
  const [darkMode, setDarkMode] = useState(
    localStorage.getItem("darkMode") === "true"
  );

  // Function to toggle dark mode
  const toggleDarkMode = () => {
    const mode = !darkMode;
    setDarkMode(mode);
    localStorage.setItem("darkMode", mode.toString());
    changeColorMode(mode);
  };

  // Function to change color mode
  const changeColorMode = (toDarkMode) => {
    if (toDarkMode) {
      document.body.className = "dark";
    } else {
      document.body.className = "light";
    }
  };

  // Fetch files on component mount
  useEffect(() => {
    getFiles();
  }, [_id]); // Fetch files when _id changes

  // Fetch files function
  const getFiles = async () => {
    let res = null;
    if (!_id) return console.log("No chat id");

    try {
      res = await instance.get("/api/chat/upload?chatId=" + _id);
    } catch (err) {
      console.log(err);
    } finally {
      if (res?.data) {
        console.log(res.data);
        setDocuments(res?.data?.data);
      }
    }
  };

  // Handle online/offline events
  useEffect(() => {
    const handleOnline = () => {
      setOffline(false);
    };

    const handleOffline = () => {
      setOffline(true);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Apply theme on initial load
  useLayoutEffect(() => {
    changeColorMode(darkMode);
  }, [darkMode]);

  return (
    <documentsContext.Provider value={{ documents, setDocuments, getFiles }}>
      <section className={user ? "main-grid" : null}>
        {user && (
          <div>
            <Menu
              changeColorMode={changeColorMode}
              file_id={file_id}
              set_file_id={set_file_id}
            />
          </div>
        )}

        {loading && <Loading />}

        {offline && (
          <Error
            status={503}
            content={"Website is offline. Please check your network connection."}
          />
        )}

        <Routes>
          <Route element={<ProtectedRoute offline={offline} authed={true} />}>
            <Route
              exact
              path="/"
              element={<Main file_id={file_id} set_file_id={set_file_id} />}
            />
            <Route path="/chat" element={<Main file_id={file_id} set_file_id={set_file_id} />} />
            <Route path="/chat/:id" element={<Main file_id={file_id} set_file_id={set_file_id} />} />
          </Route>

          <Route element={<ProtectedRoute offline={offline} />}>
            <Route path="/login" element={<Login />} />
            <Route path="/login/auth" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/signup/pending/:id" element={<Signup />} />
            <Route path="/forgot" element={<Forgot />} />
            <Route path="/forgot/set/:userId/:secret" element={<Forgot />} />
          </Route>

          <Route
            path="*"
            element={<Error status={404} content={"This page could not be found."} />}
          />
        </Routes>
      </section>

      {/* Theme toggle slider */}
      <div className="theme-toggle">
        <Switch
          onChange={toggleDarkMode}
          checked={darkMode}
          onColor="#2196F3"
          checkedIcon={<img src="<Moon/>" alt="" />}
          uncheckedIcon={<img src="<Sun/>" alt="" />}
          height={24}
          width={48}
        />
      </div>
    </documentsContext.Provider>
  );
};

export default App;
