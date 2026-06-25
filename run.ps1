Get-Content .env | ForEach-Object { set-item -force -path "ENV:$($_.Split('=')[0]) -value $_.Split('=')[1] }
ngrok start --all