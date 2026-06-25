@echo off
REM ============================================================
REM  Lance le calculateur en local (serveur HTTP + navigateur).
REM  Un simple serveur est necessaire : le navigateur bloque
REM  fetch() sur les fichiers ouverts en file://
REM ============================================================
cd /d "%~dp0"
echo Demarrage du serveur sur http://localhost:8765 ...
start "" http://localhost:8765/index.html
python -m http.server 8765
