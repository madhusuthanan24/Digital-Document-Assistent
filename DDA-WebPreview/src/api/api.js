import axios from "axios";
import { API_BASE_URL } from "../config/config";
import AsyncStorage from "@react-native-async-storage/async-storage";

const API = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

API.interceptors.request.use(
  async (config) => {
    try {
      const token = await AsyncStorage.getItem("userToken");
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (e) {
      console.error("[API Interceptor Error]", e);
    }
    return config;
  },
  (error) => Promise.reject(error)
);

export default API;
