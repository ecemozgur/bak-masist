import logging
from pathlib import Path
from typing import Optional

from app.config import (
    S3_ENABLED,
    S3_BUCKET,
    AWS_REGION,
    S3_PREFIX,
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
    S3_ENDPOINT_URL,
)

logger = logging.getLogger(__name__)

XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class S3Service:
    """
    Günlük FR-PE-0657 Excel dosyalarını AWS S3 üzerinde saklayan,
    okuyan ve güncelleyen bulut depolama servisi.
    """

    @classmethod
    def is_enabled(cls) -> bool:
        return bool(S3_ENABLED and S3_BUCKET)

    @classmethod
    def get_client(cls):
        try:
            import boto3
        except ImportError as exc:
            raise RuntimeError(
                "AWS S3 kullanmak için 'boto3' paketi gereklidir (pip install boto3)."
            ) from exc

        kwargs = {"region_name": AWS_REGION}
        if AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY:
            kwargs["aws_access_key_id"] = AWS_ACCESS_KEY_ID
            kwargs["aws_secret_access_key"] = AWS_SECRET_ACCESS_KEY
        if S3_ENDPOINT_URL:
            kwargs["endpoint_url"] = S3_ENDPOINT_URL

        return boto3.client("s3", **kwargs)

    @classmethod
    def build_key(cls, month_folder: str, filename: str) -> str:
        """Ay klasörü ve dosya adından S3 nesne anahtarını oluşturur."""
        parts = [p for p in (S3_PREFIX, month_folder.strip("/"), filename.lstrip("/")) if p]
        return "/".join(parts)

    @classmethod
    def object_exists(cls, key: str) -> bool:
        """Belirtilen S3 anahtarının bucket içinde mevcut olup olmadığını döner."""
        if not cls.is_enabled():
            return False
        from botocore.exceptions import ClientError

        client = cls.get_client()
        try:
            client.head_object(Bucket=S3_BUCKET, Key=key)
            return True
        except ClientError as exc:
            code = str(exc.response.get("Error", {}).get("Code", ""))
            if code in ("404", "NoSuchKey", "NotFound"):
                return False
            logger.error("S3 head_object hatası (%s): %s", key, exc)
            raise

    @classmethod
    def download_file(cls, key: str, local_path: Path) -> bool:
        """
        S3'teki dosyayı yerel yola indirir.
        Nesne S3'te yoksa False döner; indirildiyse True döner.
        """
        if not cls.is_enabled():
            return False
        from botocore.exceptions import ClientError

        client = cls.get_client()
        local_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = local_path.with_suffix(".tmp.xlsx")
        try:
            client.download_file(S3_BUCKET, key, str(tmp_path))
            tmp_path.replace(local_path)
            return True
        except ClientError as exc:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)
            code = str(exc.response.get("Error", {}).get("Code", ""))
            if code in ("404", "NoSuchKey", "NotFound"):
                return False
            logger.error("S3 download_file hatası (%s): %s", key, exc)
            raise

    @classmethod
    def upload_file(cls, local_path: Path, key: str) -> Optional[str]:
        """Yerel Excel dosyasını S3 bucket'ına yükler ve S3 URI döner."""
        if not cls.is_enabled():
            return None
        client = cls.get_client()
        client.upload_file(
            str(local_path),
            S3_BUCKET,
            key,
            ExtraArgs={"ContentType": XLSX_CONTENT_TYPE},
        )
        return f"s3://{S3_BUCKET}/{key}"
