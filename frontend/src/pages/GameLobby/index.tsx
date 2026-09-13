import React, { useEffect, useState } from "react";
import {
  Box,
  Button,
  Input,
  Heading,
  VStack,
  HStack,
  Center,
  useColorModeValue,
  Text,
  useToast,
} from "@chakra-ui/react";
import { createRoom, joinRoom, storeIdentity } from "../../services/api";
import { useNavigate } from "react-router-dom";
import { useSocket } from "../../context/SocketContext.tsx";

const GameLobby: React.FC = () => {
  const navigate = useNavigate();
  const { connect } = useSocket();

  const bgColor = useColorModeValue("gray.50", "gray.900");
  const cardBg = useColorModeValue("white", "gray.800");
  const textColor = useColorModeValue("gray.800", "white");
  const [playerName, setPlayerName] = useState(() => {
    return localStorage.getItem("playerName") || "";
  });
  const [roomId, setRoomId] = useState("");
  const toast = useToast();

  useEffect(() => {
    if (playerName) {
      localStorage.setItem("playerName", playerName);
    } else {
      localStorage.removeItem("playerName");
    }
  }, [playerName]);

  const showError = (error: unknown) => {
    const message = error instanceof Error ? error.message : "请求失败,请稍后重试";
    toast({
      title: message,
      status: "error",
      duration: 2500,
      position: "top",
    });
  };

  const handleCreateRoom = async () => {
    if (!playerName.trim()) {
      toast({ title: "请先填写用户昵称", status: "warning", duration: 2000, position: "top" });
      return;
    }
    try {
      const identity = await createRoom(playerName.trim());
      storeIdentity(identity.token, identity.room_id);
      connect(identity.room_id, playerName.trim(), identity.token);
      navigate("/game", {
        state: { room_id: identity.room_id, type: "create" },
      });
    } catch (error) {
      showError(error);
    }
  };

  const handleJoinRoom = async () => {
    if (!playerName.trim()) {
      toast({ title: "请先填写用户昵称", status: "warning", duration: 2000, position: "top" });
      return;
    }
    if (!roomId.trim()) {
      toast({ title: "请输入房间号", status: "warning", duration: 2000, position: "top" });
      return;
    }
    try {
      const identity = await joinRoom(roomId.trim(), playerName.trim());
      storeIdentity(identity.token, identity.room_id);
      connect(identity.room_id, playerName.trim(), identity.token);
      navigate("/game", {
        state: { room_id: identity.room_id },
      });
    } catch (error) {
      showError(error);
    }
  };

  return (
    <Box minH="100vh" p={4} bg={bgColor} w="full">
      <Center h="100vh">
        <Box
          bg={cardBg}
          borderRadius="xl"
          shadow="2xl"
          p={8}
          maxW="md"
          w="full"
          borderWidth="1px"
          borderColor={useColorModeValue("gray.200", "gray.700")}
          backdropFilter="auto"
          backdropBlur="10px"
          position="relative"
          overflow="hidden"
        >
          {/* 装饰元素 */}
          <Box
            position="absolute"
            top="-48px"
            right="-48px"
            w="160px"
            h="160px"
            bg="blue.500"
            borderRadius="full"
            opacity={0.1}
          />
          <Box
            position="absolute"
            bottom="-48px"
            left="-48px"
            w="160px"
            h="160px"
            bg="purple.500"
            borderRadius="full"
            opacity={0.1}
          />
          <Box position="relative" zIndex={10}>
            <Heading
              as="h1"
              size="2xl"
              textAlign="center"
              mb={8}
              fontWeight="bold"
              color={textColor}
            >
              游戏大厅
            </Heading>

            <VStack spacing={6} align="stretch">
              {/* 创建房间按钮 */}
              <Box>
                <Button
                  colorScheme="blue"
                  size="lg"
                  w="full"
                  py={6}
                  fontSize="lg"
                  borderRadius="md"
                  _hover={{
                    bg: "blue.600",
                    transform: "scale(1.02)",
                  }}
                  _active={{ bg: "blue.700" }}
                  _focus={{ boxShadow: "0 0 0 3px rgba(59, 130, 246, 0.5)" }}
                  transition="all 0.3s ease"
                  onClick={handleCreateRoom}
                >
                  创建房间
                </Button>
              </Box>
              <Input
                placeholder="用户昵称"
                size="lg"
                value={playerName}
                maxLength={20}
                onChange={(e) => setPlayerName(e.target.value)}
              />
              {/* 加入房间区域 */}
              <Box>
                <HStack spacing={3}>
                  <Input
                    placeholder="输入6位房间号"
                    variant="outline"
                    size="lg"
                    focusBorderColor="blue.500"
                    borderRadius="md"
                    flex="1"
                    maxLength={6}
                    _focus={{ boxShadow: "0 0 0 3px rgba(59, 130, 246, 0.3)" }}
                    bg={useColorModeValue("white", "gray.700")}
                    borderColor={useColorModeValue("gray.200", "gray.600")}
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                  />
                  <Button
                    colorScheme="green"
                    size="lg"
                    py={6}
                    borderRadius="md"
                    _hover={{
                      bg: "green.600",
                      transform: "scale(1.05)",
                    }}
                    _active={{ bg: "green.700" }}
                    _focus={{ boxShadow: "0 0 0 3px rgba(16, 185, 129, 0.5)" }}
                    transition="all 0.3s ease"
                    onClick={handleJoinRoom}
                  >
                    加入
                  </Button>
                </HStack>
              </Box>
            </VStack>
          </Box>
        </Box>
      </Center>

      {/* 页脚 */}
      <Box mt={8} textAlign="center">
        <Text fontSize="sm" color="gray.500">
          © 2026 游戏平台 | 享受游戏时光
        </Text>
      </Box>
    </Box>
  );
};

export default GameLobby;
