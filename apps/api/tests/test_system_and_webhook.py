from fastapi.testclient import TestClient


def test_health(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_telegram_webhook_secret_and_idempotency(client: TestClient) -> None:
    endpoint = "/api/v1/telegram/webhook"
    assert client.post(endpoint, json={"update_id": 77}).status_code == 401
    headers = {"X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret"}
    first = client.post(endpoint, headers=headers, json={"update_id": 77})
    second = client.post(endpoint, headers=headers, json={"update_id": 77})
    assert first.status_code == 200
    assert first.json()["duplicate"] is False
    assert second.status_code == 200
    assert second.json()["duplicate"] is True
