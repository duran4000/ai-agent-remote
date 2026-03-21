@echo off
setlocal

echo ========================================
echo Generating self-signed SSL certificate
echo ========================================

set OPENSSL_CNF=%TEMP%\openssl.cnf

echo [req] > "%OPENSSL_CNF%"
echo default_bits = 2048 >> "%OPENSSL_CNF%"
echo prompt = no >> "%OPENSSL_CNF%"
echo default_md = sha256 >> "%OPENSSL_CNF%"
echo x509_extensions = v3_req >> "%OPENSSL_CNF%"
echo distinguished_name = dn >> "%OPENSSL_CNF%"
echo. >> "%OPENSSL_CNF%"
echo [dn] >> "%OPENSSL_CNF%"
echo C = CN >> "%OPENSSL_CNF%"
echo ST = Remote >> "%OPENSSL_CNF%"
echo L = Remote >> "%OPENSSL_CNF%"
echo O = ClaudeRemote >> "%OPENSSL_CNF%"
echo OU = Development >> "%OPENSSL_CNF%"
echo CN = localhost >> "%OPENSSL_CNF%"
echo. >> "%OPENSSL_CNF%"
echo [v3_req] >> "%OPENSSL_CNF%"
echo subjectAltName = @alt_names >> "%OPENSSL_CNF%"
echo. >> "%OPENSSL_CNF%"
echo [alt_names] >> "%OPENSSL_CNF%"
echo DNS.1 = localhost >> "%OPENSSL_CNF%"
echo DNS.2 = 127.0.0.1 >> "%OPENSSL_CNF%"
echo IP.1 = 127.0.0.1 >> "%OPENSSL_CNF%"

set CERT_DIR=%~dp0..\certs
if not exist "%CERT_DIR%" mkdir "%CERT_DIR%"

openssl req -x509 -nodes -days 365 -newkey rsa:2048 ^
  -keyout "%CERT_DIR%\server.key" ^
  -out "%CERT_DIR%\server.crt" ^
  -config "%OPENSSL_CNF%"

if exist "%CERT_DIR%\server.crt" (
  echo.
  echo ========================================
  echo SSL certificate generated successfully!
  echo Location: %CERT_DIR%
  echo ========================================
  echo.
  echo Files created:
  echo   - server.crt (certificate)
  echo   - server.key (private key)
  echo.
  echo To use HTTPS, update your config.json:
  echo   "server": {
  echo     "https": true,
  echo     "httpsPort": 65437
  echo   }
  echo.
) else (
  echo.
  echo ========================================
  echo Failed to generate SSL certificate
  echo ========================================
  echo Please ensure OpenSSL is installed
)

del "%OPENSSL_CNF%" 2>nul

pause
