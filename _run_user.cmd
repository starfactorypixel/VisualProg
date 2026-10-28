@ECHO OFF

ECHO.
ECHO ^> Check updates...
CALL git pull
CALL npm install

ECHO.
ECHO ^> Run server...
CALL npm run dev -- --host --open

PAUSE
EXIT
