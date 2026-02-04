import React from "react";
import { HStack, VStack, Box, Badge, Icon } from "@chakra-ui/react";
import { FaGrinStars, FaShieldAlt } from "react-icons/fa";
import CardItem from "./CardItem";
import { COMPANY_COLORS } from "../../../constants/game";

interface InvestmentGridProps {
  investments: Record<number, number>;
  tokens: number[];
}

export const InvestmentGrid: React.FC<InvestmentGridProps> = ({
  investments,
  tokens,
}) => (
  <HStack spacing={1} wrap="wrap" justify="center" maxW="120px">
    {Object.entries(investments).map(([companyStr, count]) => {
      const company = parseInt(companyStr);
      if (count === 0) return null;
      const hasToken = tokens.includes(company);
      return (
        <VStack key={company} spacing={0} position="relative">
          <CardItem company={company} size={4} />
          <Badge
            position="absolute"
            bottom="-2"
            right="-2"
            colorScheme="blackAlpha"
            variant="solid"
            fontSize="9px"
            w="4"
            h="4"
            borderRadius="full"
            display="flex"
            alignItems="center"
            justifyContent="center"
          >
            {count}
          </Badge>
          {hasToken && (
            <Box
              position="absolute"
              top="-2"
              right="-2"
              zIndex={1}
              bg="white"
              borderRadius="full"
              borderWidth={1}
              borderColor="blackAlpha.500"
              boxShadow="sm"
              p={0.5}
              display="flex"
            >
              <Icon
                as={FaGrinStars}
                color={COMPANY_COLORS[company]}
                boxSize={"1rem"}
              />
            </Box>
          )}
        </VStack>
      );
    })}
  </HStack>
);
