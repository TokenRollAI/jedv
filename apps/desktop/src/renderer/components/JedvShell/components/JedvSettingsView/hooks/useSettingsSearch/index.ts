import { createContext, useContext } from "react";
export const SettingsSearchContext = createContext("");
export const useSettingsSearchQuery = () => useContext(SettingsSearchContext);
