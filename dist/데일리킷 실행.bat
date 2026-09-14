@echo off
title Daily Kit

rem ===========================================================
rem  Daily Kit launcher / 데일리킷 실행기
rem
rem  같은 폴더의 HTML 파일을 웹 브라우저로 엽니다.
rem  인터넷 연결 없이 동작합니다.
rem
rem  [설계 메모] 파일을 찾는 부분에는 한글을 쓰지 않습니다.
rem  cmd 는 배치 파일을 "현재 콘솔 코드페이지"로 디코딩하므로,
rem  코드페이지가 949 가 아니면 한글 리터럴이 실제 파일명과 달라집니다.
rem  아래 안내문의 한글은 표시 전용이라 깨져도 동작에는 영향이 없습니다.
rem ===========================================================

setlocal

rem --- 1순위: 이름이 정확히 맞는 파일 (한국어 Windows 기본 환경) ---
set "APP=%~dp0데일리킷.html"
if exist "%APP%" goto :open

rem --- 2순위: 같은 폴더에 HTML 이 하나뿐이면 그것을 엽니다 (순수 ASCII 경로) ---
set "APP="
set /a HTMLCOUNT=0
for %%F in ("%~dp0*.html") do (
    set /a HTMLCOUNT+=1
    if not defined APP set "APP=%%~fF"
)
if %HTMLCOUNT%==1 goto :open
if %HTMLCOUNT%==0 goto :notfound
goto :toomany

:open
echo.
echo  Opening in your default web browser...
echo  브라우저에서 여는 중입니다...
echo.
echo  File: "%APP%"
echo.
echo  If it opens in a text editor instead of a browser,
echo  right-click the .html file and choose Open with - your browser.
echo  편집기로 열리면 그 html 을 오른쪽 클릭 - 연결 프로그램 - 브라우저를 선택하세요.
echo.
start "" "%APP%"
endlocal
exit /b 0

:notfound
echo.
echo  [ERROR] No .html file found next to this launcher.
echo  [오류] 이 실행기와 같은 폴더에서 html 파일을 찾지 못했습니다.
echo.
echo  Put this .bat and the app .html in the SAME folder, then run again.
echo  이 bat 파일과 앱 html 파일을 같은 폴더에 두고 다시 실행해 주세요.
echo.
echo  Folder: "%~dp0"
echo.
pause
endlocal
exit /b 1

:toomany
echo.
echo  [ERROR] Found %HTMLCOUNT% .html files here - cannot decide which to open.
echo  [오류] 이 폴더에 html 파일이 %HTMLCOUNT% 개 있어 어느 것을 열지 정할 수 없습니다.
echo.
echo  Move this launcher and the app .html into their own folder.
echo  이 실행기와 앱 html 만 따로 폴더에 옮겨 주세요.
echo.
echo  Folder: "%~dp0"
echo.
pause
endlocal
exit /b 1
