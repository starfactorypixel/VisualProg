@echo off
:: Определяем текущую директорию ::
SET CurrentFolder=%~dp0%
CD /D "%CurrentFolder%"
:: ::
npm run dev
pause