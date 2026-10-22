from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    jwt_secret: str = "alpharay-dev-secret-change-me-in-production"
    jwt_ttl_hours: int = 12
    data_file: str = "data/state.json"
    upload_dir: str = "uploads"
    max_upload_mb: int = 20
    timezone: str = "Europe/Moscow"
    demo_reset_enabled: bool = False
    demo_accounts_on_login: bool = True

    assistant_enabled: bool = True
    llm_base_url: str = "https://api.groq.com/openai/v1"
    llm_api_key: str = Field(default="", validation_alias=AliasChoices("LLM_API_KEY", "GROQ_API_KEY"))
    llm_model: str = "openai/gpt-oss-120b"
    llm_temperature: float = 0.3
    llm_max_tokens: int = 900
    llm_reasoning_effort: str = ""
    llm_max_rounds: int = 5
    llm_request_timeout: float = 12.0
    llm_connect_timeout: float = 4.0
    llm_total_timeout: float = 18.0
    llm_history_messages: int = 8

    @property
    def assistant_available(self) -> bool:
        return self.assistant_enabled and bool(self.llm_api_key.strip()) and bool(self.llm_model.strip())

    @property
    def data_path(self) -> Path | None:
        return Path(self.data_file) if self.data_file.strip() else None

    @property
    def upload_path(self) -> Path | None:
        return Path(self.upload_dir) if self.upload_dir.strip() else None


settings = Settings()
