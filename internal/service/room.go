package service

type RoomService interface {
	GetRoom() string
}

type roomServiceImpl struct {
}

func NewRoomService() RoomService {
	return &roomServiceImpl{}
}
func (r *roomServiceImpl) GetRoom() string {
	return "创建成功"
}
