from fastapi import HTTPException, status
from fastapi.responses import JSONResponse


class APIException(HTTPException):
    """Standard API exception returning {code, message} shape."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        field: str | None = None,
        extra: dict | None = None,
    ):
        self.code = code
        self.message = message
        self.field = field
        self.extra = extra or {}
        super().__init__(status_code=status_code, detail=message)

    def to_response(self) -> JSONResponse:
        loc = ["body", self.field] if self.field else ["body"]
        error = {
            "type": self.code.lower(),
            "loc": loc,
            "msg": self.message,
        }
        content = {
            "code": self.code,
            "message": self.message,
            "detail": [error],
            **self.extra,
        }
        return JSONResponse(status_code=self.status_code, content=content)



class ResourceNotFoundException(APIException):
    def __init__(self, message: str):
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            code="RESOURCE_NOT_FOUND",
            message=message,
        )


class ValidationException(APIException):
    def __init__(self, message: str, field: str | None = None):
        super().__init__(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="VALIDATION_ERROR",
            message=message,
            field=field,
        )


class ConflictException(APIException):
    def __init__(self, message: str, field: str | None = None):
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            code="CONFLICT",
            message=message,
            field=field,
        )
