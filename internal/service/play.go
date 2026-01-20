package service

type PlayService interface {
}

type playServiceImpl struct {
}

func NewPlayService() PlayService {
	return &playServiceImpl{}
}
