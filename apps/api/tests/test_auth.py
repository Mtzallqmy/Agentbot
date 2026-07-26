from fastapi.testclient import TestClient


def test_login_me_logout(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "owner@example.test", "password": "correct horse battery staple"},
    )
    assert response.status_code == 200
    assert response.json()["role"] == "superadmin"
    assert "HttpOnly" in response.headers["set-cookie"]

    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == "owner@example.test"

    admin = client.get("/api/v1/admin/metrics")
    assert admin.status_code == 200
    assert admin.json()["users"] == 1

    assert client.post("/api/v1/auth/logout").status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 401


def test_wrong_password_and_protected_endpoint(client: TestClient) -> None:
    assert client.get("/api/v1/admin/metrics").status_code == 401
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "owner@example.test", "password": "wrong"},
    )
    assert response.status_code == 401
