import os

from selenium import webdriver


def create_browser():
    options = webdriver.ChromeOptions()

    if os.getenv("COLLECTOR_HEADLESS", "false").lower() == "true":
        options.add_argument("--headless=new")

    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--window-size=1440,1200")

    chrome_binary = os.getenv("CHROME_BIN")
    if chrome_binary:
        options.binary_location = chrome_binary

    driver = webdriver.Chrome(
        options=options
    )
    driver.set_page_load_timeout(
        float(os.getenv("COLLECTOR_PAGE_TIMEOUT_SECONDS", "30"))
    )
    driver.set_script_timeout(
        float(os.getenv("COLLECTOR_SCRIPT_TIMEOUT_SECONDS", "15"))
    )
    return driver
