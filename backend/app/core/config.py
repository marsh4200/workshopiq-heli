"""Application configuration loaded from environment variables."""
from functools import lru_cache
from typing import List

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    APP_NAME: str = "WorkshopIQ"
    # Version is normally injected at deploy time from the checked-out git tag
    # (scripts/update.sh writes APP_VERSION into .env, compose passes it in).
    # This literal is only a fallback for fresh/dev runs with no tag available —
    # you don't need to bump it for normal tagged releases.
    APP_VERSION: str = "3.1"
    API_PREFIX: str = "/api"
    ENVIRONMENT: str = "production"

    # Public base URL used when generating QR check-in links (no trailing slash).
    # e.g. https://workshopiq.arsmarthome.co.za
    # If left blank, the URL is derived from the incoming request headers
    # (works automatically behind nginx / Cloudflare tunnel).
    PUBLIC_BASE_URL: str = ""

    # Server
    PORT: int = 9918

    # Reports: local timezone offset (hours) used to bucket jobs into
    # calendar months/years. Defaults to SAST (UTC+2).
    REPORT_TZ_OFFSET_HOURS: int = 2

    # Security
    SECRET_KEY: str = "change-me-in-production-please-use-a-long-random-string"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours
    ALGORITHM: str = "HS256"

    # Database
    POSTGRES_USER: str = "workshopiq"
    POSTGRES_PASSWORD: str = "workshopiq"
    POSTGRES_DB: str = "workshopiq"
    POSTGRES_HOST: str = "db"
    POSTGRES_PORT: int = 5432

    # Default admin bootstrap
    DEFAULT_ADMIN_USERNAME: str = "admin"
    DEFAULT_ADMIN_PASSWORD: str = "admin"

    # Uploads
    UPLOAD_DIR: str = "/app/uploads"
    MAX_UPLOAD_MB: int = 50

    # CORS
    CORS_ORIGINS: List[str] = ["*"]

    @field_validator("APP_VERSION", mode="before")
    @classmethod
    def clean_version(cls, v):
        # The deploy pipeline may inject the tag as e.g. "v3.2" or, if nothing
        # is set, an empty string. Strip a leading "v" and fall back to the
        # field default when blank so the version is never wiped out.
        if v is None:
            return v
        v = str(v).strip().lstrip("v")
        return v or "3.1"

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def split_cors(cls, v):
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @property
    def sync_database_url(self) -> str:
        return (
            f"postgresql://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
