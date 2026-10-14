' Launch the tum log sync with no visible window (Task Scheduler calls this).
CreateObject("WScript.Shell").Run """C:\Users\example-user\Projects\asteria\scripts\sync-tum-logs.cmd""", 0, False
