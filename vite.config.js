import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({plugins:[tailwindcss()],root:'ui',build:{outDir:'../dist',emptyOutDir:true},server:{port:1420,strictPort:true}});
