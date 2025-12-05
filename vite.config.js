// vite.config.js

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // This setting enables the simulated browser environment
    environment: 'jsdom', 
    
    // Optional: Enables global access to describe, it, expect, etc.
    // If you set this to true, you don't need to import them manually.
    // globals: true, 
  },
});