import time
import undetected_chromedriver as uc

print("1. Iniciando script...")

driver = uc.Chrome(
    version_main=151,
    headless=False,
    use_subprocess=True,
)

print("2. Chrome criado.")

driver.get("https://example.com")

print("3. Página aberta.")
print("Título:", driver.title)
print("URL:", driver.current_url)

time.sleep(60)

driver.quit()