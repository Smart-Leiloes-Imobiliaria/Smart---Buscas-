from selenium import webdriver

print("1. Iniciando Selenium...")

options = webdriver.ChromeOptions()

driver = webdriver.Chrome(options=options)

print("2. Chrome aberto.")

driver.get("https://example.com")

print("3. Página carregada.")
print("Título:", driver.title)
print("URL:", driver.current_url)

input("Pressione ENTER para fechar...")

driver.quit()