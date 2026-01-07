package errors

// AppError 业务错误结构，包含 code 和 message
type AppError struct {
	Code    int
	Message string
}

func (e *AppError) Error() string {
	return e.Message
}

// NewAppError 创建业务错误
func NewAppError(code int, message string) *AppError {
	return &AppError{Code: code, Message: message}
}

// 预定义常用错误
var (
	ErrInvalidParam = NewAppError(400, "invalid request parameters")
	ErrUserNotFound = NewAppError(1001, "user not found")
	ErrInternal     = NewAppError(500, "internal server error")
)
