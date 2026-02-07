import { Box } from "@chakra-ui/react";
import React from "react";

// const COMPANIES = [5, 6, 7, 8, 9, 10];

const COMPANY_COLORS: Record<number, string> = {
  5: "#fbbf24",
  6: "#fca5a5",
  7: "#06b6d4",
  8: "#c084fc",
  9: "#84cc16",
  10: "#f43f5e",
};

export default function CardItem({
  company,
  size = 3,
}: {
  company: number;
  size?: number;
}) {
  return (
    <Box
      w={`${size * 0.75}rem`}
      h={`${size}rem`}
      bg={COMPANY_COLORS[company]}
      borderRadius={size * 2}
      borderWidth={2}
      borderColor="whiteAlpha.500"
      display="flex"
      alignItems="center"
      justifyContent="center"
      fontSize={`${size * 0.65}rem`}
      fontWeight="800"
      color="white"
      // fontFamily="'Montserrat', sans-serif"
      fontFamily="'Fredoka', sans-serif"
    >
      {company}
    </Box>
  );
}
