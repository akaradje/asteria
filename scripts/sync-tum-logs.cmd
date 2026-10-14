@echo off
rem Runs the tum log sync under Git Bash (called by sync-tum-logs-hidden.vbs
rem so the Task Scheduler task does not flash a console window every 10 min).
"C:\Users\example-user\AppData\Local\hermes\git\usr\bin\bash.exe" "C:\Users\example-user\Projects\asteria\scripts\sync-tum-logs.sh"
