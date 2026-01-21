package router

import (
	"STARTUPS/internal/controller"
	"net/http"

	"github.com/gin-gonic/gin"
)

type APIRouter struct {
	roomController *controller.RoomController
	playController *controller.PlayController
}

func NewAPIRouter() *APIRouter {
	return &APIRouter{
		roomController: controller.NewRoomHandler(),
		playController: controller.NewPlayHandler(),
	}
}

func (c *APIRouter) RegisterRouter(r *gin.RouterGroup) {
	r.POST("/room/create", c.roomController.Create)
	r.POST("/room/join", c.roomController.Join)
	r.DELETE("/room/leave", c.roomController.Leave)
	r.GET("/room/status", c.roomController.Status)
	r.POST("/room/start", c.roomController.Start)
	r.POST("/room/ready", c.roomController.Ready)

	r.POST("/play/lead", nil)
	r.POST("/play/draw", nil)
	r.POST("/play/", nil)
	r.POST("/play/", nil)
}

func SetupRouter(r *gin.Engine) {
	//普通路由
	r.GET("/", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"message": "hello world",
		})
	})
	//组织路由
	NewAPIRouter().RegisterRouter(r.Group("/api/"))

}
